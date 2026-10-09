import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { accessibilityFindings, performanceFindings } from "../src/core/findings.js";
import { createRun } from "../src/core/run.js";
import type { HealthSignals, PerfMetrics, RunManifest } from "../src/core/types.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

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

const statuses = (manifest: RunManifest) =>
  Object.fromEntries(manifest.jobs.map((job) => [job.route, job.status]));

describe("accessibility and performance checks", () => {
  it("are off by default", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/a11y", "/heavy"],
    });
    const { manifest } = await createRun(config).start();
    expect(statuses(manifest)).toEqual({ "/a11y": "pass", "/heavy": "pass" });
    expect(manifest.jobs[0]!.captures.staging!.health.accessibility).toBeUndefined();
  });

  it("report problems that are new on staging, even when the pixels are identical", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/identical", "/a11y", "/heavy"],
      checks: {
        accessibility: true,
        performance: { weightIncreaseKB: 20, weightIncreasePercent: 10 },
      },
    });
    const { manifest } = await createRun(config).start();
    expect(statuses(manifest)).toEqual({
      "/identical": "pass",
      "/a11y": "review",
      "/heavy": "review",
    });

    const a11y = manifest.jobs.find((job) => job.route === "/a11y")!;
    expect(a11y.diff!.diffPixels).toBe(0);
    const messages = a11y.findings!.map((finding) => finding.message);
    expect(messages).toContainEqual(
      expect.stringMatching(/^Accessibility \(critical\).*\[image-alt\]$/),
    );
    expect(messages).toContainEqual(
      expect.stringMatching(/^Accessibility \(critical\).*\[button-name\]$/),
    );
    // The footer fails colour contrast on both sides: not new, so not reported.
    expect(a11y.captures.production!.health.accessibility!.map((item) => item.id)).toEqual([
      "color-contrast",
    ]);
    expect(messages.some((message) => message.includes("color-contrast"))).toBe(false);

    const heavy = manifest.jobs.find((job) => job.route === "/heavy")!;
    expect(heavy.findings).toContainEqual(
      expect.objectContaining({
        severity: "review",
        message: expect.stringMatching(/^More JavaScript: 0 KB → \d+ KB$/),
      }),
    );
    const metrics = heavy.captures.staging!.health.performance!;
    expect(metrics.jsKB).toBeGreaterThan(50);
    expect(metrics.requests).toBe(2);
    expect(metrics.domNodes).toBeGreaterThan(5);
    expect(metrics.fcpMs).toBeGreaterThan(0);
  }, 120_000);
});

describe("check findings", () => {
  const settings = parseConfig({ checks: { accessibility: true, performance: true } }).checks;
  const violation = (id: string, count: number, targets: string[]) => ({
    id,
    impact: "serious" as const,
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/${id}`,
    count,
    targets,
  });
  const health = (extra: Partial<HealthSignals>): HealthSignals => ({
    consoleErrors: [],
    failedRequests: [],
    brokenImages: [],
    ...extra,
  });

  it("counts only additional failing elements per rule, at the configured impact", () => {
    const reference = health({ accessibility: [violation("color-contrast", 2, ["p.a", "p.b"])] });
    const current = health({
      accessibility: [
        violation("color-contrast", 3, ["p.a", "p.b", "p.c"]),
        { ...violation("region", 4, ["div"]), impact: "moderate" },
      ],
    });
    expect(accessibilityFindings(current, reference, settings.accessibility)).toEqual([
      {
        severity: "review",
        source: "health",
        message:
          "Accessibility (serious): color-contrast help — 1 new element: p.c [color-contrast]",
      },
    ]);
    expect(
      accessibilityFindings(current, reference, { ...settings.accessibility, minImpact: "minor" }),
    ).toHaveLength(2);
    // Nothing to compare with: listed as info so turning the check on fails nothing.
    expect(accessibilityFindings(current, health({}), settings.accessibility)).toEqual([
      expect.objectContaining({ severity: "info" }),
    ]);
  });

  it("flags slower, shiftier and heavier pages beyond the margins", () => {
    const metrics = (extra: Partial<PerfMetrics>): PerfMetrics => ({
      lcpMs: 1200,
      cls: 0.01,
      requests: 10,
      transferKB: 800,
      jsKB: 300,
      domNodes: 500,
      ...extra,
    });
    const before = health({ performance: metrics({}) });
    expect(
      performanceFindings(
        health({ performance: metrics({ lcpMs: 1900, cls: 0.05, transferKB: 880 }) }),
        before,
        settings.performance,
      ),
    ).toEqual([]);
    expect(
      performanceFindings(
        health({ performance: metrics({ lcpMs: 3400, cls: 0.25, transferKB: 1300, jsKB: 520 }) }),
        before,
        settings.performance,
      ).map((finding) => finding.message),
    ).toEqual([
      "Slower load: LCP 1.2s → 3.4s",
      "More layout shift while loading: CLS 0.01 → 0.25",
      "Heavier page: 800 KB → 1.3 MB (+63%)",
      "More JavaScript: 300 KB → 520 KB",
    ]);
  });

  it("accepts true, false or options in the config", () => {
    const parsed = parseConfig({ checks: { accessibility: { minImpact: "moderate" } } }).checks;
    expect(parsed.accessibility).toMatchObject({ enabled: true, minImpact: "moderate" });
    expect(parsed.performance.enabled).toBe(false);
    expect(parseConfig({}).checks.accessibility.enabled).toBe(false);
  });
});
