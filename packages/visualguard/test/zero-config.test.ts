/**
 * @file Tests positional URL routing and first/subsequent single-site snapshot scans.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTargetURL, routesForTargets } from "../src/cli/commands/zero-config.js";
import { createRun } from "../src/core/run.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

describe("positional URLs (PLAN.md §6.5)", () => {
  it("splits a URL into base and page", () => {
    expect(parseTargetURL("https://example.com")).toEqual({
      base: "https://example.com/",
      route: undefined,
      host: "example.com",
    });
    expect(parseTargetURL("https://example.com/pricing?x=1")).toMatchObject({
      base: "https://example.com/",
      route: "/pricing?x=1",
    });
    expect(() => parseTargetURL("example.com")).toThrow(/not a URL/);
  });

  it.each([
    [["https://a.com"], undefined],
    [["https://a.com/pricing"], ["/pricing"]],
    [["https://a.com", "https://b.com"], undefined],
    [["https://a.com/pricing", "https://b.com/pricing"], ["/pricing"]],
    [["https://a.com/pricing", "https://b.com"], ["/pricing"]],
    [["https://a.com", "https://b.com/plans"], ["/plans"]],
    [["https://a.com/pricing", "https://b.com/plans"], [{ path: "/pricing", staging: "/plans" }]],
  ])("%j → %j", (urls, expected) => {
    expect(routesForTargets(urls.map(parseTargetURL))).toEqual(expected);
  });
});

describe("scan mode", () => {
  let site: FixtureServer;
  beforeAll(async () => {
    site = await startFixtureServer("staging");
  });
  afterAll(() => site.close());

  it("saves snapshots on the first scan and compares on the next", async () => {
    const config = testConfig(
      { routes: ["/identical", "/missing-image", "/does-not-exist"] },
      { production: site.url, staging: site.url },
    );
    const baselineDir = join(config.outputDir, "snapshots", "site");
    const options = { mode: "scan" as const, baselineDir, updateBaselines: true };

    const first = await createRun(config, options).start();
    const firstStatus = Object.fromEntries(
      first.manifest.jobs.map((job) => [job.route, job.status]),
    );
    expect(first.manifest.mode).toBe("scan");
    expect(first.manifest.config.baseURL).toEqual({ staging: site.url });
    expect(firstStatus).toEqual({
      "/identical": "pass",
      "/missing-image": "review",
      "/does-not-exist": "review",
    });
    expect(first.manifest.jobs[0]!.captures.production).toBeUndefined();
    expect(readdirSync(baselineDir).sort()).toContain("identical__desktop.png");

    const second = await createRun(config, options).start();
    const identical = second.manifest.jobs.find((job) => job.route === "/identical")!;
    expect(identical.captures.production?.source).toBe("baseline");
    expect(identical.status).toBe("pass");
    expect(existsSync(join(second.runDir, identical.captures.production!.image))).toBe(true);
    // Known problems are reported again in scan mode (there is no live production to compare with).
    expect(second.manifest.jobs.find((job) => job.route === "/missing-image")!.status).toBe(
      "review",
    );
  }, 120_000);
});
