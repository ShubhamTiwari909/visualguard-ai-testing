import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runVisualGuard, ConfigError, type VisualGuardConfig } from "../src/index.js";

const directories: string[] = [];
let origin: string;
const server = createServer((request, response) => {
  const changed = request.url?.includes("staging");
  response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><style>body{margin:0}header{height:60px;background:${changed ? "red" : "blue"}}section{width:200px;height:100px;background:green}</style><header>Outside section</header><section data-visualguard="checkout">Checkout</section>`);
});
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});
function cwd() {
  const directory = mkdtempSync(join(tmpdir(), "vg-sdk-"));
  directories.push(directory);
  return directory;
}
function config(): VisualGuardConfig {
  return {
    baseURL: { production: `${origin}/production`, staging: `${origin}/production` },
    routes: ["/"],
    viewports: { desktop: { width: 400, height: 300 } },
    ai: { provider: "none" },
    stabilize: { retries: 0, stabilityAttempts: 1, stabilityIntervalMs: 0, networkQuietMs: 0, scrollToLoad: false },
  };
}

describe("script and CI SDK", () => {
  it("returns a policy verdict and usable HTML, JUnit, JSON and screenshots without changing exit status", async () => {
    const exitCode = process.exitCode;
    const events: string[] = [];
    let customReporterFinished = false;
    const result = await runVisualGuard({
      cwd: cwd(), config: config(), env: {},
      onEvent: (event) => { events.push(event.type); },
      reporters: [{ name: "consumer", async onRunEnd() { await Promise.resolve(); customReporterFinished = true; } }],
    });
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.manifest.summary.pass).toBe(1);
    expect(customReporterFinished).toBe(true);
    expect(events).toEqual(["run:start", "job:start", "job:captured", "job:captured", "job:end", "run:end"]);
    expect(process.exitCode).toBe(exitCode);
    for (const path of Object.values(result.artifacts)) {
      expect(isAbsolute(path)).toBe(true);
      expect(existsSync(path)).toBe(true);
    }
    expect(JSON.parse(readFileSync(result.artifacts.manifest, "utf8")).id).toBe(result.manifest.id);
    expect(readFileSync(result.artifacts.html!, "utf8")).toContain("<html");
    expect(readFileSync(result.artifacts.junit!, "utf8")).toContain('failures="0"');
    expect(existsSync(join(result.runDir, result.manifest.jobs[0]!.captures.staging!.image))).toBe(true);
  });

  it("uses the selected failure policy for changed pages and JUnit", async () => {
    const settings = config();
    settings.baseURL!.staging = `${origin}/staging`;
    const strict = await runVisualGuard({ cwd: cwd(), config: settings, env: {}, failOn: "review" });
    expect(strict.manifest.summary.review).toBe(1);
    expect(strict.passed).toBe(false);
    expect(strict.exitCode).toBe(1);
    expect(readFileSync(strict.artifacts.junit!, "utf8")).toContain('failures="1"');
    const permissive = await runVisualGuard({ cwd: cwd(), config: settings, env: {}, failOn: "regression", reports: { html: false, junit: false } });
    expect(permissive.passed).toBe(true);
    expect(permissive.artifacts.html).toBeUndefined();
    expect(permissive.artifacts.junit).toBeUndefined();
  });

  it("captures a data-attribute section and ignores visual changes outside it", async () => {
    const settings = config();
    settings.baseURL!.staging = `${origin}/staging`;
    settings.screenshot = { selector: '[data-visualguard="checkout"]' };
    const result = await runVisualGuard({ cwd: cwd(), config: settings, env: {} });
    expect(result.passed).toBe(true);
    expect(result.manifest.jobs[0]!.captures.staging!.size).toEqual({ width: 200, height: 100 });
  });

  it("returns capture errors as failed comparison results", async () => {
    const settings = config();
    settings.screenshot = { selector: "#absent" };
    settings.browser = { actionTimeoutMs: 100 };
    const result = await runVisualGuard({ cwd: cwd(), config: settings, env: {} });
    expect(result.passed).toBe(false);
    expect(result.manifest.summary.error).toBe(1);
    expect(readFileSync(result.artifacts.junit!, "utf8")).toContain("<error");
  });

  it("discovers config and resolves overrides over copied environment files", async () => {
    const directory = cwd();
    const settings = config();
    settings.baseURL = {};
    writeFileSync(join(directory, "visualguard.config.mjs"), `export default ${JSON.stringify(settings)}`);
    writeFileSync(join(directory, ".env"), `VISUALGUARD_PRODUCTION_URL=${origin}/staging\nVISUALGUARD_STAGING_URL=${origin}/staging\nVISUALGUARD_SDK_TEST=from-file\n`);
    writeFileSync(join(directory, ".env.local"), `VISUALGUARD_STAGING_URL=${origin}/production\n`);
    const env = { VISUALGUARD_PRODUCTION_URL: `${origin}/production` };
    const original = process.env.VISUALGUARD_SDK_TEST;
    const result = await runVisualGuard({ cwd: directory, env, overrides: { staging: `${origin}/production` } });
    expect(result.passed).toBe(true);
    expect(env).toEqual({ VISUALGUARD_PRODUCTION_URL: `${origin}/production` });
    expect(process.env.VISUALGUARD_SDK_TEST).toBe(original);
    await expect(runVisualGuard({ cwd: directory, env: {}, loadEnv: false })).rejects.toThrow("Compare mode requires");
  });

  it("supports an explicit relative config path and optional CI reports", async () => {
    const directory = cwd();
    writeFileSync(join(directory, "check.mjs"), `export default ${JSON.stringify(config())}`);
    writeFileSync(join(directory, "summary.md"), "Previous step\n");
    const result = await runVisualGuard({
      cwd: directory, configPath: "check.mjs", env: { GITHUB_STEP_SUMMARY: "summary.md" },
      reports: { junit: "results/visual.xml", githubSummary: true, reportURL: "https://reports.example.test/run" },
    });
    expect(result.artifacts.junit).toBe(join(directory, "results/visual.xml"));
    expect(result.artifacts.githubSummary).toBe(join(directory, "summary.md"));
    const summary = readFileSync(result.artifacts.githubSummary!, "utf8");
    expect(summary).toContain("Previous step");
    expect(summary).toContain("https://reports.example.test/run");
  });

  it("requires explicit baseline creation and reuses saved section references", async () => {
    const directory = cwd();
    const settings = config();
    settings.mode = "baseline";
    settings.baseURL = { staging: origin };
    settings.screenshot = { selector: '[data-visualguard="checkout"]' };
    const missing = await runVisualGuard({ cwd: directory, config: settings, env: {} });
    expect(missing.passed).toBe(false);
    const created = await runVisualGuard({ cwd: directory, config: settings, env: {}, updateBaselines: true });
    expect(created.passed).toBe(true);
    const checked = await runVisualGuard({ cwd: directory, config: settings, env: {} });
    expect(checked.passed).toBe(true);
    expect(checked.manifest.jobs[0]!.captures.production!.source).toBe("baseline");
  });

  it("rejects cancellation before capture and during capture", async () => {
    const directory = cwd();
    const pre = new AbortController();
    pre.abort(new Error("Already stopped"));
    await expect(runVisualGuard({ cwd: directory, config: config(), signal: pre.signal })).rejects.toThrow("Already stopped");
    expect(existsSync(join(directory, ".visualguard"))).toBe(false);
    const active = new AbortController();
    await expect(runVisualGuard({ cwd: directory, config: config(), env: {}, signal: active.signal,
      onEvent(event) { if (event.type === "job:start") active.abort(new Error("Stop capture")); },
    })).rejects.toThrow("Stop capture");
  });

  it("does not let a broken progress observer stop a run", async () => {
    const result = await runVisualGuard({ cwd: cwd(), config: config(), env: {}, onEvent() { throw new Error("Display failure"); } });
    expect(result.passed).toBe(true);
  });

  it("rejects final reporter failures instead of returning a successful CI verdict", async () => {
    await expect(runVisualGuard({
      cwd: cwd(), config: config(), env: {},
      reporters: [{ name: "delivery", async onRunEnd() { throw new Error("Report delivery failed"); } }],
    })).rejects.toThrow("Report delivery failed");
  });

  it("rejects invalid SDK input before creating output", async () => {
    const directory = cwd();
    for (const options of [
      { configPath: "conflict.mjs" },
      { failOn: "anything" as "review" },
      { shard: { index: 0, total: 2 } },
      { shard: { index: 1, total: 1.5 } },
      { updateBaselines: true },
      { overrides: { concurrency: 0 } },
      { reports: { junit: " " } },
      { reports: { githubSummary: true } },
    ]) {
      await expect(runVisualGuard({ cwd: directory, config: config(), env: {}, ...options })).rejects.toBeInstanceOf(ConfigError);
    }
    await expect(runVisualGuard({ cwd: directory, config: {}, env: {} })).rejects.toThrow("Compare mode requires");
    await expect(runVisualGuard({ cwd: directory, config: { mode: "baseline" }, env: {} })).rejects.toThrow("Baseline mode requires");
    expect(existsSync(join(directory, ".visualguard"))).toBe(false);
  });
});
