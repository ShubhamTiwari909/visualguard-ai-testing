import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runVisualGuard,
  ConfigError,
  type SDKMonitorOptions,
  type VisualGuardConfig,
} from "../src/index.js";
import { resolveMonitorRun } from "../src/config/monitor.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

const directories: string[] = [];
let production: FixtureServer;
let staging: FixtureServer;
let healthURL: string;
let newBroken = false;
const health = createServer((request, response) => {
  if (request.url === "/known.svg" || (request.url === "/new.svg" && newBroken)) {
    response.writeHead(404).end("Missing image");
  } else if (request.url === "/new.svg") {
    response
      .writeHead(200, { "content-type": "image/svg+xml" })
      .end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>',
      );
  } else {
    response
      .writeHead(200, { "content-type": "text/html" })
      .end(
        '<!doctype html><style>body{margin:0}section{width:240px;height:100px;background:white}</style><section data-visualguard="panel"><img width="20" height="20" src="/known.svg"><img width="20" height="20" src="/new.svg"></section>',
      );
  }
});
beforeAll(async () => {
  production = await startFixtureServer("production");
  staging = await startFixtureServer("staging");
  await new Promise<void>((done) => health.listen(0, "127.0.0.1", done));
  healthURL = `http://127.0.0.1:${(health.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await production?.close();
  await staging?.close();
  await new Promise<void>((done) => health.close(() => done()));
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});
function cwd() {
  const path = mkdtempSync(join(tmpdir(), "vg-sdk-monitor-"));
  directories.push(path);
  return path;
}
function config(site: string, routes = ["/identical"]): VisualGuardConfig {
  return {
    baseURL: { production: site },
    routes,
    viewports: { desktop: { width: 500, height: 400 } },
    ai: { provider: "none" },
    stabilize: {
      networkQuietMs: 0,
      retries: 0,
      stabilityAttempts: 1,
      stabilityIntervalMs: 0,
      scrollToLoad: false,
    },
  };
}
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const statuses = (result: Awaited<ReturnType<typeof runVisualGuard>>) =>
  Object.fromEntries(result.manifest.jobs.map((job) => [job.route, job.status]));

describe("SDK monitor", () => {
  it("rolls eligible snapshots forward, retains regressions across days, and returns reports", async () => {
    const directory = cwd();
    const summary = join(directory, "summary.md");
    writeFileSync(summary, "");
    const monitor = (site: string) =>
      runVisualGuard({
        cwd: directory,
        config: config(site, ["/identical", "/text-change", "/hidden"]),
        monitor: { dir: "visualguard/snapshots", update: "unless-regression" },
        env: { GITHUB_STEP_SUMMARY: summary },
        reports: { githubSummary: true },
      });
    const first = await monitor(production.url);
    expect(first.manifest.mode).toBe("monitor");
    expect(statuses(first)).toEqual({
      "/identical": "pass",
      "/text-change": "pass",
      "/hidden": "pass",
    });
    expect(first.snapshotDir).toBe(join(directory, "visualguard/snapshots"));
    const snapshot = join(first.snapshotDir!, "hidden__desktop.png");
    const before = sha(snapshot);
    const second = await monitor(staging.url);
    expect(second.exitCode).toBe(1);
    expect(statuses(second)).toEqual({
      "/identical": "pass",
      "/text-change": "review",
      "/hidden": "regression",
    });
    expect(sha(snapshot)).toBe(before);
    const third = await monitor(staging.url);
    expect(statuses(third)).toEqual({
      "/identical": "pass",
      "/text-change": "pass",
      "/hidden": "regression",
    });
    expect(sha(snapshot)).toBe(before);
    for (const path of [
      third.artifacts.manifest,
      third.artifacts.html!,
      third.artifacts.junit!,
      third.artifacts.githubSummary!,
    ])
      expect(existsSync(path)).toBe(true);
    expect(readFileSync(third.artifacts.junit!, "utf8")).toContain('failures="1"');
    expect(readFileSync(summary, "utf8")).toContain("regression");
  }, 120_000);

  it("compares known and new broken images with baseline health in section captures", async () => {
    const directory = cwd();
    const settings = config(healthURL, ["/"]);
    settings.screenshot = { selector: '[data-visualguard="panel"]' };
    const run = (reset = false) =>
      runVisualGuard({
        cwd: directory,
        config: settings,
        env: {},
        monitor: { dir: "snapshots", reset },
      });
    newBroken = false;
    const seeded = await run(true);
    expect(seeded.manifest.summary.review).toBe(1);
    const known = await run();
    expect(known.passed).toBe(true);
    expect(known.manifest.jobs[0]!.captures.staging!.size).toEqual({ width: 240, height: 100 });
    const snapshot = join(known.snapshotDir!, `${known.manifest.jobs[0]!.id}.png`);
    const before = sha(snapshot);
    newBroken = true;
    const changed = await run();
    expect(changed.manifest.summary.regression).toBe(1);
    const findings = changed.manifest.jobs[0]!.findings ?? [];
    expect(
      findings.some((item) => item.severity === "regression" && item.message.includes("/new.svg")),
    ).toBe(true);
    expect(
      findings.some(
        (item) => item.severity === "regression" && item.message.includes("/known.svg"),
      ),
    ).toBe(false);
    expect(sha(snapshot)).toBe(before);
    expect((await run()).manifest.summary.regression).toBe(1);
    expect(sha(snapshot)).toBe(before);
  }, 120_000);

  it("rejects incompatible captures without modifying references until explicitly reset", async () => {
    const directory = cwd();
    const settings = config(production.url);
    const run = (reset = false) =>
      runVisualGuard({
        cwd: directory,
        config: settings,
        env: {},
        monitor: { dir: "snapshots", reset },
      });
    const first = await run();
    const snapshot = join(first.snapshotDir!, "identical__desktop.png");
    const before = sha(snapshot);
    settings.viewports = { desktop: { width: 700, height: 400 } };
    await expect(run()).rejects.toThrow(/rendering settings do not match/i);
    expect(sha(snapshot)).toBe(before);
    await run(true);
    expect(sha(snapshot)).not.toBe(before);
    expect((await run()).passed).toBe(true);
  }, 120_000);

  it("uses the CLI host-scoped path and staging fallback with monitor true", async () => {
    const directory = cwd();
    const settings = config(production.url);
    settings.baseURL = { staging: production.url };
    settings.monitor = { dir: "visualguard/monitor" };
    const result = await runVisualGuard({
      cwd: directory,
      config: settings,
      env: {},
      monitor: true,
    });
    const host = new URL(production.url).host.replace(/[^a-z0-9.-]+/gi, "_");
    expect(result.snapshotDir).toBe(join(directory, "visualguard/monitor", host));
    expect(result.passed).toBe(true);
  });

  it("shares CLI update/reset resolution without mutating the original config", () => {
    const resolved = testConfig({
      ...config(production.url),
      baseURL: { production: production.url, staging: staging.url },
    });
    directories.push(resolved.cwd);
    const result = resolveMonitorRun(resolved);
    expect(result.config.baseURL).toEqual({ production: production.url, staging: production.url });
    expect(resolved.baseURL.staging).toBe(staging.url);
    expect(result.options).toMatchObject({
      mode: "monitor",
      baselineHealth: true,
      updateBaselines: "unless-regression",
    });
    expect(resolveMonitorRun(resolved, { update: "always" }).options.updateBaselines).toBe(true);
    expect(resolveMonitorRun(resolved, { reset: true }).options.updateBaselines).toBe(true);
    expect(resolveMonitorRun(resolved, { dir: "exact" }).snapshotDir).toBe(
      resolve(resolved.cwd, "exact"),
    );
  });

  it("rejects invalid or conflicting monitor options before creating output", async () => {
    const directory = cwd();
    const invalid: unknown[] = [
      false,
      null,
      [],
      { dir: " " },
      { update: "sometimes" },
      { reset: "yes" },
      { baselineHealth: false },
    ];
    for (const monitor of invalid) {
      await expect(
        runVisualGuard({
          cwd: directory,
          config: config(production.url),
          env: {},
          monitor: monitor as SDKMonitorOptions,
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    }
    await expect(
      runVisualGuard({
        cwd: directory,
        config: config(production.url),
        env: {},
        monitor: true,
        updateBaselines: true,
      }),
    ).rejects.toThrow(/monitor.reset/);
    await expect(
      runVisualGuard({ cwd: directory, config: {}, env: {}, monitor: true }),
    ).rejects.toThrow(/Nothing to monitor/);
    expect(existsSync(join(directory, ".visualguard"))).toBe(false);
  });
});
