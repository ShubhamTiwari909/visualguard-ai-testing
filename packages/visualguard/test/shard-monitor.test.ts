import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeRuns } from "../src/core/merge.js";
import { createRun, parseShard, shardJobs } from "../src/core/run.js";
import type { RunManifest } from "../src/core/types.js";
import { renderMonitorWorkflow } from "../src/setup/workflow-template.js";
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

describe("sharding", () => {
  it("deals jobs out round-robin by id, the same way on every machine", () => {
    const jobs = ["e", "a", "d", "b", "c"].map((id) => ({ id }));
    const parts = [1, 2].map((index) => shardJobs(jobs, { index, total: 2 }).map((job) => job.id));
    expect(parts).toEqual([
      ["a", "c", "e"],
      ["b", "d"],
    ]);
    expect(shardJobs([...jobs].reverse(), { index: 1, total: 2 }).map((job) => job.id)).toEqual(
      parts[0],
    );
    expect(parseShard("2/4")).toEqual({ index: 2, total: 4 });
    for (const bad of ["0/4", "5/4", "1", "a/b"]) expect(() => parseShard(bad)).toThrow(/--shard/);
  });

  it("merges shard runs into one run with one report", async () => {
    const routes = ["/identical", "/text-change", "/color-change", "/hidden"];
    const shardRuns = [];
    for (const index of [1, 2]) {
      const config = testConfig({
        baseURL: { production: production.url, staging: staging.url },
        routes,
      });
      const { manifest, runDir } = await createRun(config, { shard: { index, total: 2 } }).start();
      expect(manifest.shard).toEqual({ index, total: 2 });
      expect(manifest.jobs).toHaveLength(2);
      shardRuns.push({ config, runDir });
    }

    const target = testConfig({ baseURL: { production: production.url, staging: staging.url } });
    const { manifest, runDir } = await mergeRuns(
      target,
      shardRuns.map((run) => run.config.outputDir),
    );
    expect(statuses(manifest)).toEqual({
      "/color-change": "review",
      "/hidden": "regression",
      "/identical": "pass",
      "/text-change": "review",
    });
    expect(manifest.summary).toMatchObject({ pass: 1, review: 2, regression: 1 });
    expect(manifest.mergedFrom).toHaveLength(2);
    expect(manifest.shard).toBeUndefined();
    // Screenshots were copied, so the merged report is complete.
    const hidden = manifest.jobs.find((job) => job.route === "/hidden")!;
    expect(existsSync(join(runDir, hidden.captures.staging!.image))).toBe(true);
    expect(existsSync(join(runDir, "manifest.json"))).toBe(true);
  }, 120_000);
});

describe("monitor mode", () => {
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

  it("compares with the previous capture and rolls snapshots forward except regressions", async () => {
    const snapshots = mkdtempSync(join(tmpdir(), "vg-monitor-"));
    const routes = ["/identical", "/text-change", "/hidden"];
    const monitor = (site: string) => {
      const config = testConfig({ baseURL: { production: site, staging: site }, routes });
      return createRun(config, {
        mode: "monitor",
        baselineDir: snapshots,
        updateBaselines: "unless-regression",
        baselineHealth: true,
      }).start();
    };

    const first = await monitor(production.url);
    expect(first.manifest.mode).toBe("monitor");
    expect(Object.values(statuses(first.manifest))).toEqual(["pass", "pass", "pass"]);
    const hiddenSnapshot = join(snapshots, "hidden__desktop.png");
    const before = sha(hiddenSnapshot);

    // The site changes overnight (here: the staging fixture plays tomorrow's production).
    const second = await monitor(staging.url);
    expect(statuses(second.manifest)).toEqual({
      "/identical": "pass",
      "/text-change": "review",
      "/hidden": "regression",
    });
    expect(sha(hiddenSnapshot)).toBe(before);

    // The reviewed change became the new reference; the regression is reported again.
    const third = await monitor(staging.url);
    expect(statuses(third.manifest)).toEqual({
      "/identical": "pass",
      "/text-change": "pass",
      "/hidden": "regression",
    });
  }, 120_000);

  it("writes a scheduled workflow that keeps the captures in the Actions cache", () => {
    const yaml = renderMonitorWorkflow("pnpm", { schedule: "0 3 * * *", url: "https://acme.test" });
    expect(yaml).toContain('- cron: "0 3 * * *"');
    expect(yaml).toContain("pnpm exec visualguard monitor https://acme.test --ci");
    expect(yaml).toContain("restore-keys: visualguard-monitor-");
    expect(yaml).toContain("VISUALGUARD_WEBHOOK_URL: ${{ secrets.VISUALGUARD_WEBHOOK_URL }}");
  });
});
