import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun } from "../src/core/run.js";
import { readRunIndex } from "../src/core/runs.js";
import { exitCodeFor } from "../src/core/status.js";
import type { RunManifest } from "../src/core/types.js";
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
  Object.fromEntries(manifest.jobs.map((job) => [`${job.route} ${job.viewport}`, job.status]));

describe("test pipeline on the fixture site", () => {
  it("passes unchanged pages and flags changed ones", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: [
        "/",
        "/identical",
        "/animated",
        { path: "/dynamic", mask: [".random"] },
        "/text-change",
        "/color-change",
        "/alignment",
        "/missing-image",
        "/does-not-exist",
      ],
    });
    const events: string[] = [];
    const run = createRun(config);
    run.on("job:end", (event) => events.push(event.job.id));
    const { manifest, runDir } = await run.start();

    expect(statuses(manifest)).toEqual({
      "/ desktop": "pass",
      "/identical desktop": "pass",
      "/animated desktop": "pass",
      "/dynamic desktop": "pass",
      "/text-change desktop": "review",
      "/color-change desktop": "review",
      "/alignment desktop": "review",
      "/missing-image desktop": "regression",
      "/does-not-exist desktop": "pass",
    });
    expect(events).toHaveLength(9);
    expect(manifest.summary).toMatchObject({ pass: 5, review: 3, regression: 1, error: 0 });
    expect(exitCodeFor(manifest, "regression")).toBe(1);
    expect(exitCodeFor(manifest, "review")).toBe(1);

    // Artifacts and manifest on disk.
    const saved = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8")) as RunManifest;
    expect(saved.id).toBe(manifest.id);
    expect(readRunIndex(config.outputDir).runs.map((entry) => entry.id)).toEqual([manifest.id]);

    const colour = manifest.jobs.find((job) => job.route === "/color-change")!;
    expect(colour.regions.length).toBeGreaterThan(0);
    expect(existsSync(join(runDir, colour.diff!.image!))).toBe(true);
    expect(existsSync(join(runDir, colour.regions[0]!.crops!.staging))).toBe(true);
    // The changed button is inside the region.
    const box = colour.regions[0]!.box;
    expect(box.width).toBeLessThan(400);
    expect(box.height).toBeLessThan(100);

    const missing = manifest.jobs.find((job) => job.route === "/missing-image")!;
    expect(missing.findings).toContainEqual(
      expect.objectContaining({ severity: "regression", message: "Broken image: /product-v2.svg" }),
    );
    expect(missing.captures.staging!.health.brokenImages[0]).toContain("/product-v2.svg");
    expect(missing.captures.staging!.health.failedRequests.join()).toContain("404");

    const notFound = manifest.jobs.find((job) => job.route === "/does-not-exist")!;
    expect(notFound.captures.production!.health.status).toBe(404);
  }, 180_000);

  it("records capture errors without stopping the run", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: [{ path: "/identical", waitFor: "#never-appears" }, "/"],
      browser: { actionTimeoutMs: 1_000 },
      stabilize: { retries: 0 },
    });
    const { manifest } = await createRun(config, { failOn: "regression" }).start();
    const failed = manifest.jobs.find((job) => job.route === "/identical")!;
    expect(failed.status).toBe("error");
    expect(failed.error?.stage).toBe("capture");
    expect(manifest.jobs.find((job) => job.route === "/")!.status).toBe("pass");
    expect(exitCodeFor(manifest, "regression")).toBe(1);
  }, 120_000);

  it("prunes runs beyond output.keepRuns", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: production.url },
      routes: ["/identical"],
      output: { keepRuns: 2 },
    });
    const dirs: string[] = [];
    for (let i = 0; i < 3; i++)
      dirs.push((await createRun(config, { skipReachabilityCheck: true }).start()).runDir);
    expect(existsSync(dirs[0]!)).toBe(false);
    expect(existsSync(dirs[1]!)).toBe(true);
    expect(readRunIndex(config.outputDir).runs.map((run) => run.number)).toEqual([2, 3]);
  }, 120_000);
});

describe("dynamic content", () => {
  it("ignores areas that change on every load (noise map) and marked elements", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/dynamic", "/dynamic-change", "/marked-dynamic"],
    });
    const { manifest, runDir } = await createRun(config).start();
    expect(statuses(manifest)).toEqual({
      "/dynamic desktop": "pass",
      "/dynamic-change desktop": "review",
      "/marked-dynamic desktop": "pass",
    });

    const dynamic = manifest.jobs.find((job) => job.route === "/dynamic")!;
    expect(dynamic.diff!.noise).toMatchObject({ env: "production" });
    expect(dynamic.diff!.noise!.boxes.length).toBeGreaterThan(0);
    expect(dynamic.findings).toContainEqual(
      expect.objectContaining({
        severity: "info",
        message: expect.stringMatching(/^Ignored 1 area/),
      }),
    );
    // The second capture is only kept for --debug.
    expect(existsSync(join(runDir, "jobs", dynamic.id, "production.again.png"))).toBe(false);

    // The real change is still found, and only the real change.
    const changed = manifest.jobs.find((job) => job.route === "/dynamic-change")!;
    expect(changed.regions).toHaveLength(1);
    expect(changed.regions[0]!.deltas).toContainEqual(
      expect.objectContaining({ kind: "style", property: "background-color" }),
    );

    // Marked elements never differ, so no second capture was needed.
    const marked = manifest.jobs.find((job) => job.route === "/marked-dynamic")!;
    expect(marked.diff!.diffPixels).toBe(0);
    expect(marked.diff!.noise).toBeUndefined();
  });

  it("flags dynamic content when the noise map is off", async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/dynamic"],
      diff: { noiseMap: false },
    });
    const { manifest } = await createRun(config).start();
    expect(manifest.jobs[0]!.status).toBe("review");
  });
});

describe("determinism", () => {
  const runs = Number.parseInt(process.env.VG_DETERMINISM_RUNS ?? "2", 10);

  it(`captures every fixture page identically ${runs}× (production vs production)`, async () => {
    const config = testConfig({
      baseURL: { production: production.url, staging: production.url },
      routes: [
        "/",
        "/identical",
        "/animated",
        { path: "/dynamic", mask: [".random"] },
        "/alignment",
        "/layout-shift",
        "/overflow",
        "/missing-image",
      ],
      viewports: {
        desktop: { width: 1440, height: 900 },
        mobile: { width: 390, height: 844, isMobile: true },
      },
      diff: { maxDiffPixels: 0 },
    });
    for (let i = 0; i < runs; i++) {
      const { manifest } = await createRun(config).start();
      const unstable = manifest.jobs.filter(
        (job) => job.status !== "pass" || (job.diff?.diffPixels ?? 0) > 0,
      );
      expect(
        unstable.map((job) => `${job.id}: ${job.diff?.diffPixels}px ${job.error?.message ?? ""}`),
      ).toEqual([]);
    }
  }, 300_000);
});
