/**
 * @file Tests quarantine entries: validation, expiry, what they may cover, and how quarantined
 * checks reach exit codes, JUnit, terminal and markdown output.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import type { QuarantineEntry } from "../src/config/schema.js";
import { applyQuarantine, isQuarantineActive, quarantineWarnings } from "../src/core/quarantine.js";
import { createRun } from "../src/core/run.js";
import { exitCodeFor, summarize } from "../src/core/status.js";
import type { JobResult, RunManifest } from "../src/core/types.js";
import { renderJUnit } from "../src/reporters/ci.js";
import { renderMarkdown } from "../src/reporters/markdown.js";
import { jobDetail } from "../src/reporters/terminal.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

const NOW = new Date("2026-11-15T12:00:00Z");
const entry = (overrides: Partial<QuarantineEntry> = {}): QuarantineEntry => ({
  route: "/pricing",
  owner: "web-team",
  reason: "carousel timing",
  expires: "2026-11-30",
  ...overrides,
});

/**
 * Create a finished check with the given status. Only the fields quarantine and the reporters
 * read are filled in.
 */
const job = (overrides: Partial<JobResult> = {}): JobResult =>
  ({
    id: `${overrides.route ?? "/pricing"}__${overrides.viewport ?? "desktop"}`,
    route: "/pricing",
    viewport: "desktop",
    status: "review",
    urls: { production: "https://example.com/pricing", staging: "https://staging/pricing" },
    captures: {},
    regions: [],
    findings: [{ severity: "review", message: "Colour changed", source: "heuristic" }],
    durationMs: 100,
    ...overrides,
  }) as JobResult;

/**
 * Wrap checks in the smallest manifest the reporters accept.
 */
const manifestOf = (jobs: JobResult[]): RunManifest =>
  ({
    schemaVersion: 1,
    id: "run",
    number: 1,
    startedAt: NOW.toISOString(),
    durationMs: 1000,
    mode: "compare",
    tool: { version: "0", playwright: "0", node: "22", browser: "chromium" },
    config: {
      baseURL: { production: "https://example.com", staging: "https://staging" },
      viewports: { desktop: { width: 1440, height: 900 } },
      ai: { provider: "none" },
      failOn: "review",
    },
    summary: summarize(jobs),
    jobs,
  }) as RunManifest;

describe("quarantine configuration", () => {
  it("requires an owner, a reason and a real expiry date", () => {
    const parse = (quarantine: unknown[]) =>
      parseConfig({
        baseURL: { production: "https://example.com", staging: "https://staging.example.com" },
        quarantine,
      } as never);
    expect(parse([entry()]).quarantine).toEqual([entry()]);
    expect(parse([]).quarantine).toEqual([]);
    expect(() => parse([{ ...entry(), owner: " " }])).toThrow(/owns fixing/);
    expect(() => parse([{ ...entry(), reason: "" }])).toThrow(/why the check/);
    expect(() => parse([{ ...entry(), expires: "next week" }])).toThrow(/2026-12-31/);
    expect(() => parse([{ ...entry(), expires: "2026-13-45" }])).toThrow(/real calendar date/);
    // Date.parse would roll these over into March.
    expect(() => parse([{ ...entry(), expires: "2026-02-30" }])).toThrow(/real calendar date/);
    expect(() => parse([{ ...entry(), expires: "2026-02-29" }])).toThrow(/real calendar date/);
    expect(parse([{ ...entry(), expires: "2028-02-29" }]).quarantine[0]!.expires).toBe(
      "2028-02-29",
    );
    expect(() => parse([{ ...entry(), route: "https://example.com/pricing" }])).toThrow(/paths/);
  });

  it("applies through the end of the expiry day, UTC", () => {
    expect(isQuarantineActive(entry(), new Date("2026-11-30T23:59:59Z"))).toBe(true);
    expect(isQuarantineActive(entry(), new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
});

describe("applyQuarantine", () => {
  it("marks a visual review or regression and keeps the status as found", () => {
    for (const status of ["review", "regression"] as const) {
      const result = applyQuarantine(job({ status }), [entry()], NOW);
      expect(result.status).toBe(status);
      expect(result.quarantined).toEqual({
        owner: "web-team",
        reason: "carousel timing",
        expires: "2026-11-30",
      });
    }
  });

  it("never covers passes, errors, health problems, other checks or expired entries", () => {
    const cases: Array<[JobResult, QuarantineEntry]> = [
      [job({ status: "pass" }), entry()],
      [job({ status: "error", error: { stage: "capture", message: "timeout" } }), entry()],
      [
        job({
          status: "regression",
          findings: [{ severity: "regression", message: "Broken image", source: "health" }],
        }),
        entry(),
      ],
      [job({ route: "/checkout" }), entry()],
      [job({ viewport: "mobile" }), entry({ viewport: "desktop" })],
      [job(), entry({ expires: "2026-11-14" })],
    ];
    for (const [check, quarantine] of cases)
      expect(applyQuarantine(check, [quarantine], NOW).quarantined).toBeUndefined();
    // Info-level health notes do not block a quarantine.
    const noted = job({
      findings: [{ severity: "info", message: "Slow request", source: "health" }],
    });
    expect(applyQuarantine(noted, [entry()], NOW).quarantined).toBeDefined();
  });

  it("warns about expired entries and entries that match no check", () => {
    const warnings = quarantineWarnings(
      [
        entry({ expires: "2026-11-01" }),
        entry({ route: "/typo" }),
        entry({ viewport: "tablet" }),
        entry(),
      ],
      [{ route: "/pricing", viewport: "desktop" }],
      NOW,
    );
    expect(warnings).toEqual([
      "Quarantine for /pricing expired on 2026-11-01; it counts again. Owner: web-team.",
      "Quarantine for /typo matches no check in this run.",
      "Quarantine for /pricing (tablet) matches no check in this run.",
    ]);
  });
});

describe("quarantined checks in results", () => {
  const quarantined = applyQuarantine(job({ status: "regression" }), [entry()], NOW);

  it("do not fail the run, while other failing checks still do", () => {
    expect(exitCodeFor(manifestOf([quarantined, job({ status: "pass" })]), "review")).toBe(0);
    expect(
      exitCodeFor(manifestOf([quarantined, job({ route: "/a", status: "review" })]), "review"),
    ).toBe(1);
    expect(exitCodeFor({ ...manifestOf([quarantined]), incomplete: true }, "regression")).toBe(1);
    // A summary alone cannot see quarantine, so it keeps the strict answer.
    expect(exitCodeFor({ summary: summarize([quarantined]) }, "regression")).toBe(1);
  });

  it("are skipped in JUnit and labelled in the terminal and PR comment", () => {
    const manifest = manifestOf([quarantined, job({ route: "/a", status: "regression" })]);
    const junit = renderJUnit(manifest, "regression");
    expect(junit).toContain('failures="1" errors="0" skipped="1"');
    expect(junit).toContain(
      '<skipped message="Quarantined until 2026-11-30 (owner: web-team): carousel timing"/>',
    );
    expect(jobDetail(quarantined)).toBe("quarantined until 2026-11-30 (web-team): Colour changed");
    const markdown = renderMarkdown(manifest);
    expect(markdown).toContain("🧊 1 quarantined");
    // escapeMarkdown escapes the parentheses.
    expect(markdown).toContain("Quarantined until 2026-11-30 \\(web-team\\): Colour changed");
  });
});

describe("quarantine in a real run", () => {
  let production: FixtureServer;
  let staging: FixtureServer;
  beforeAll(async () => {
    production = await startFixtureServer("production");
    staging = await startFixtureServer("staging");
  });
  afterAll(async () => {
    await production?.close();
    await staging?.close();
  });

  it("lets a quarantined visual change pass the run but not a broken image", async () => {
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/color-change", "/missing-image"],
      viewports: { desktop: { width: 1440, height: 900 } },
      quarantine: [
        { route: "/color-change", owner: "design", reason: "rebrand in progress", expires },
        { route: "/missing-image", owner: "web", reason: "CDN migration", expires },
      ],
    });
    const { manifest } = await createRun(config).start();
    const byRoute = Object.fromEntries(manifest.jobs.map((check) => [check.route, check]));
    expect(byRoute["/color-change"]!.status).toBe("review");
    expect(byRoute["/color-change"]!.quarantined?.owner).toBe("design");
    expect(byRoute["/missing-image"]!.status).toBe("regression");
    expect(byRoute["/missing-image"]!.quarantined).toBeUndefined();
    expect(exitCodeFor(manifest, "review")).toBe(1);
    expect(exitCodeFor({ ...manifest, jobs: [byRoute["/color-change"]!] }, "review")).toBe(0);
  });
});
