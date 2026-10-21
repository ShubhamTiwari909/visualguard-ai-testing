import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturePage } from "../src/capture/capture.js";
import { captureDomSnapshot, type DomSnapshot } from "../src/capture/dom-snapshot.js";
import { parseConfig } from "../src/config/load.js";
import { expandRoutes } from "../src/config/urls.js";
import { buildJobs } from "../src/core/jobs.js";
import { fingerprint, renderingIdentity } from "../src/core/provenance.js";
import { createRun } from "../src/core/run.js";
import { decodePNG } from "../src/diff/image.js";
import { verifyAgainstProduction } from "../src/fixer/verify.js";
import { testConfig } from "./helpers/config.js";

const selector = '[data-visualguard="checkout"]';
let browser: Browser;
let origin: string;
const server = createServer((request, response) => {
  const path = request.url ?? "/";
  const staging = path.includes("/staging/");
  const scenario = path.split("/").pop();
  const section = `<section data-visualguard="checkout" style="width:240px;height:${scenario === "tall" ? 400 : 140}px;background:${scenario === "inside" && staging ? "red" : "blue"};position:relative;${scenario === "hidden" ? "display:none" : scenario === "transparent" ? "opacity:0" : ""}"><button data-testid="pay" style="position:absolute;left:20px;top:30px;width:100px;height:40px">${scenario === "masked" && staging ? "New price" : "Pay now"}</button></section>`;
  response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><style>body{margin:0}header{height:${scenario === "offset" && staging ? 900 : 600}px;background:${staging ? "pink" : "yellow"}}main{margin-left:80px}</style><header>Outside section</header><main style="${scenario === "ancestor-transparent" ? "opacity:0" : ""}">${scenario === "missing" || scenario === "delayed" ? "" : section}${scenario === "duplicate" ? section : ""}<aside data-visualguard="summary" style="height:80px;width:100px;background:green">Summary</aside></main>${scenario === "delayed" ? `<template id="delayed-section">${section}</template><script>setTimeout(()=>document.querySelector('main').prepend(document.querySelector('#delayed-section').content.cloneNode(true)),100)</script>` : ""}`);
});

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

function config(path = "/outside") {
  return testConfig({
    baseURL: { production: `${origin}/production`, staging: `${origin}/staging` },
    routes: [path],
    screenshot: { selector },
    browser: { actionTimeoutMs: 500 },
    stabilize: { retries: 0, stabilityAttempts: 1, stabilityIntervalMs: 0, networkQuietMs: 0, scrollToLoad: false },
    ai: { provider: "none" },
  });
}

function job(settings: ReturnType<typeof config>) {
  return buildJobs(settings, expandRoutes(settings.routes as string[]).routes)[0]!;
}

describe("section configuration and identity", () => {
  it("rejects blank selectors globally and per route", () => {
    expect(() => parseConfig({ screenshot: { selector: "  " } })).toThrow();
    expect(() => parseConfig({ routes: [{ path: "/", screenshot: { selector: "" } }] })).toThrow();
  });

  it("keeps multiple sections on a page distinct and supports page overrides", () => {
    const settings = config();
    const routes = expandRoutes([
      { path: "/", name: "Checkout", screenshot: { selector } },
      { path: "/", name: "Summary", screenshot: { selector: '[data-visualguard="summary"]' } },
      { path: "/", name: "Page", screenshot: { selector: null } },
    ]).routes;
    const jobs = buildJobs(settings, routes);
    expect(new Set(jobs.map((item) => item.id)).size).toBe(3);
    expect(jobs.find((item) => item.name === "Page")!.id).toBe("index__desktop");
    expect(jobs[0]!.screenshotSelector).toBe(selector);
    const pageIdentity = renderingIdentity(settings, jobs[2]!);
    expect(pageIdentity.policy.screenshot).not.toHaveProperty("selector");
    expect(fingerprint(pageIdentity)).not.toBe(fingerprint(renderingIdentity(settings, jobs[0]!)));
    const plain = { ...settings, screenshot: { fullPage: true, maxHeight: 15_000 } };
    expect(fingerprint(pageIdentity)).toBe(fingerprint(renderingIdentity(plain, { ...jobs[2]!, screenshotSelector: undefined })));
  });
});

describe("real browser section capture", () => {
  it("captures only the section, with scoped DOM coordinates even below the fold", async () => {
    const settings = config();
    let dom: DomSnapshot | undefined;
    const outcome = await capturePage({ browser, config: settings, job: job(settings), env: "staging",
      afterScreenshot: async (page, target) => { dom = await captureDomSnapshot(page, 4_000, target); },
    });
    expect(outcome.size).toEqual({ width: 240, height: 140 });
    expect(outcome.truncated).toBe(false);
    expect(dom!.nodes[0]!.box).toEqual([0, 0, 240, 140]);
    expect(dom!.nodes.find((node) => node.key === "testid:pay")!.box).toEqual([20, 30, 100, 40]);
    expect(dom!.nodes.some((node) => node.tag === "header" || node.tag === "aside")).toBe(false);
    expect(dom!.nodes.every((node, index) => node.i === index && (node.p === -1 || node.p < index))).toBe(true);
  });

  it("compares section changes without counting outside content or vertical offsets", async () => {
    const settings = config();
    settings.routes = ["/outside", "/inside", "/offset"];
    const { manifest, runDir } = await createRun(settings, { skipReachabilityCheck: true }).start();
    const byRoute = Object.fromEntries(manifest.jobs.map((item) => [item.route, item]));
    expect(byRoute["/outside"]!.status).toBe("pass");
    expect(byRoute["/offset"]!.status).toBe("pass");
    expect(byRoute["/inside"]!.diff!.diffPixels).toBeGreaterThan(10_000);
    expect(byRoute["/inside"]!.status).not.toBe("pass");
    expect(byRoute["/inside"]!.capturePolicy!.screenshot.selector).toBe(selector);
    // Repair verification replays saved scope even when the current config has changed.
    const verification = await verifyAgainstProduction(
      { ...settings, screenshot: { ...settings.screenshot, selector: '[data-visualguard="summary"]' } },
      byRoute["/outside"]!, `${origin}/staging`, runDir,
    );
    expect(verification.resolved).toBe(true);
    expect(verification.job.captures.staging!.size).toEqual({ width: 240, height: 140 });
  }, 60_000);

  it("waits for a section inserted after navigation", async () => {
    const settings = config("/delayed");
    const outcome = await capturePage({ browser, config: settings, job: job(settings), env: "staging" });
    expect(outcome.size).toEqual({ width: 240, height: 140 });
  });

  it("preserves route masks inside a section", async () => {
    const settings = config("/masked");
    const spec = { ...job(settings), mask: ['[data-testid="pay"]'] };
    const a = await capturePage({ browser, config: settings, job: spec, env: "production" });
    const b = await capturePage({ browser, config: settings, job: spec, env: "staging" });
    expect(a.png.equals(b.png)).toBe(true);
    const image = decodePNG(a.png);
    const offset = (40 * image.width + 30) * 4;
    expect([...image.data.subarray(offset, offset + 3)]).toEqual([255, 0, 255]);
  });

  it.each(["missing", "hidden", "duplicate"])("reports %s targets instead of capturing the page", async (scenario) => {
    const settings = config(`/${scenario}`);
    await expect(capturePage({ browser, config: settings, job: job(settings), env: "staging" })).rejects.toThrow(/exactly one visible element/);
  });

  it.each(["transparent", "ancestor-transparent"])("rejects a %s section rather than saving blank evidence", async (scenario) => {
    const settings = config(`/${scenario}`);
    await expect(capturePage({ browser, config: settings, job: job(settings), env: "staging" })).rejects.toThrow(/must be visible/);
  });

  it("rejects malformed selectors and oversized sections", async () => {
    const invalid = config();
    invalid.screenshot.selector = "[";
    await expect(capturePage({ browser, config: invalid, job: job(invalid), env: "staging" })).rejects.toThrow(/exactly one visible element/);
    const tall = config("/tall");
    tall.screenshot.maxHeight = 200;
    await expect(capturePage({ browser, config: tall, job: job(tall), env: "staging" })).rejects.toThrow(/exceeding screenshot.maxHeight/);
  });

  it("can capture the full page despite a global selector", async () => {
    const settings = config();
    const outcome = await capturePage({ browser, config: settings, job: { ...job(settings), screenshotSelector: null }, env: "staging" });
    expect(outcome.size.width).toBe(1440);
    expect(outcome.size.height).toBeGreaterThan(140);
  });

  it("saves and reuses section baselines with matching DOM evidence", async () => {
    const settings = config();
    settings.mode = "baseline";
    settings.baseline.missing = "create";
    const options = { mode: "baseline" as const, baselineDir: join(settings.cwd, settings.baseline.dir), skipReachabilityCheck: true };
    const first = await createRun(settings, { ...options, updateBaselines: true }).start();
    const second = await createRun(settings, options).start();
    const saved = second.manifest.jobs[0]!;
    expect(saved.status).toBe("pass");
    expect(saved.captures.production!.source).toBe("baseline");
    expect(saved.captures.production!.size).toEqual({ width: 240, height: 140 });
    const dom = JSON.parse(readFileSync(join(first.runDir, first.manifest.jobs[0]!.captures.staging!.dom!), "utf8"));
    expect(dom.nodes[0].box).toEqual([0, 0, 240, 140]);
  }, 60_000);
});
