import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun } from "../src/core/run.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

describe("baseline mode", () => {
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

  it("saves baselines with --update-baselines and compares later runs against them", async () => {
    const routes = ["/identical", "/alignment", "/hidden"];
    const site = (url: string) =>
      testConfig(
        { mode: "baseline", routes, baseline: { missing: "create" } },
        { production: url, staging: url },
      );
    const first = site(production.url);
    const baselineDir = resolve(first.cwd, first.baseline.dir);

    const empty = await createRun(first, { mode: "baseline", baselineDir }).start();
    expect(empty.manifest.jobs.map((job) => job.findings?.[0]?.message)).toEqual(
      routes.map(() => "No baseline yet; run with --update-baselines to save one"),
    );
    expect(existsSync(baselineDir)).toBe(false);

    await createRun(first, { mode: "baseline", baselineDir, updateBaselines: true }).start();
    expect(readdirSync(baselineDir).sort()).toEqual(
      ["alignment__desktop", "hidden__desktop", "identical__desktop"].flatMap((id) => [
        `${id}.dom.json`,
        `${id}.health.json`,
        `${id}.meta.json`,
        `${id}.png`,
      ]),
    );

    // The site changes (staging fixtures); the committed baselines still hold the old look.
    const next = site(staging.url);
    const { manifest } = await createRun(
      { ...next, cwd: first.cwd, baseline: first.baseline },
      { mode: "baseline", baselineDir },
    ).start();
    expect(manifest.mode).toBe("baseline");
    const statuses = Object.fromEntries(manifest.jobs.map((job) => [job.route, job.status]));
    expect(statuses).toEqual({
      "/identical": "pass",
      "/alignment": "review",
      "/hidden": "regression",
    });
    expect(manifest.jobs.find((job) => job.route === "/hidden")!.findings![0]!.message).toContain(
      "is missing on staging",
    );
    expect(join(baselineDir)).toContain("visualguard/baselines");
  }, 120_000);
});
