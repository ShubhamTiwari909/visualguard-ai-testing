import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { capturePage, stabilizeAndShoot } from "../capture/capture.js";
import { captureDomSnapshot, type DomSnapshot } from "../capture/dom-snapshot.js";
import { loadConfig, loadEnvFiles, parseConfig } from "../config/load.js";
import { resolveConfig, type ResolvedConfig } from "../config/resolve.js";
import type { VisualGuardConfig } from "../config/schema.js";
import { routeSlug } from "../config/urls.js";
import { applyFindings, healthFindings } from "../core/findings.js";
import { isFailing } from "../core/status.js";
import type { CaptureResult, FailOn, HealthSignals, JobResult, JobSpec } from "../core/types.js";
import { pngSize } from "../core/util.js";
import { computeDiff } from "../diff/compute.js";
import { classifyJob } from "../mapping/classify.js";

export interface VisualGuardOptions {
  /** Path to a config file (default: visualguard.config.* in the working directory). */
  configPath?: string;
  /** Inline config, merged over the file. */
  config?: VisualGuardConfig;
  /** What fails the test (default "regression"). */
  failOn?: FailOn;
}

export interface CheckOptions {
  /** Name for this check, unique within the test (default "page"). */
  name?: string;
  waitFor?: string;
  mask?: string[];
  hide?: string[];
  failOn?: FailOn;
}

export interface VisualGuardFixture {
  /**
   * Compares the page as it is now with production (same path on baseURL.production), or with
   * a stored baseline when there's no production URL. Fails the test per `failOn`.
   */
  check(page: Page, options?: CheckOptions): Promise<JobResult>;
}

function readDom(path: string): DomSnapshot | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DomSnapshot) : undefined;
}

function productionURL(config: ResolvedConfig, current: URL): string {
  const production = new URL(config.baseURL.production!);
  const staging = config.baseURL.staging ? new URL(config.baseURL.staging) : undefined;
  let path = current.pathname;
  if (staging && current.origin === staging.origin && path.startsWith(staging.pathname)) {
    path = `/${path.slice(staging.pathname.length).replace(/^\//, "")}`;
  }
  const base = production.pathname.replace(/\/$/, "");
  return `${production.origin}${base}${path}${current.search}${current.hash}`;
}

async function check(
  baseConfig: ResolvedConfig,
  page: Page,
  options: CheckOptions,
  defaults: VisualGuardOptions,
  testInfo: TestInfo,
): Promise<JobResult> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const config: ResolvedConfig = {
    ...baseConfig,
    viewports: { playwright: { width: size.width, height: size.height } },
  };
  const name = options.name ?? "page";
  const current = new URL(page.url());
  const id = `${routeSlug(testInfo.titlePath.slice(1).join(" ").replace(/\s+/g, "-"))}__${routeSlug(`/${name}`)}`;
  const dir = testInfo.outputPath("visualguard", routeSlug(`/${name}`));
  mkdirSync(dir, { recursive: true });

  const job: JobSpec = {
    id,
    route: current.pathname,
    name,
    viewport: "playwright",
    urls: {
      production: config.baseURL.production ? productionURL(config, current) : current.href,
      staging: current.href,
    },
    waitFor: options.waitFor,
    mask: options.mask ?? [],
    hide: options.hide ?? [],
  };

  // The current page, as the test left it.
  const health: HealthSignals = { consoleErrors: [], failedRequests: [], brokenImages: [] };
  const hookContext = {
    page,
    env: "staging" as const,
    route: job.route,
    url: current.href,
    viewport: job.viewport,
  };
  const started = Date.now();
  const shot = await stabilizeAndShoot(page, { config, job, health, hookContext });
  const stagingPath = join(dir, "staging.png");
  writeFileSync(stagingPath, shot.png);
  writeFileSync(join(dir, "staging.dom.json"), JSON.stringify(await captureDomSnapshot(page)));
  const captures: JobResult["captures"] = {
    staging: {
      source: "live",
      image: stagingPath,
      size: shot.size,
      durationMs: Date.now() - started,
      attempts: 1,
      health,
    },
  };

  // The reference: production, or a stored baseline.
  const productionPath = join(dir, "production.png");
  const baselineDir = resolve(config.cwd, config.baseline.dir, "playwright");
  const baselinePath = join(baselineDir, `${id}.png`);
  const updating =
    testInfo.config.updateSnapshots === "all" ||
    testInfo.config.updateSnapshots === "changed" ||
    Boolean(process.env.VISUALGUARD_UPDATE_BASELINES);
  if (config.baseURL.production) {
    const browser = page.context().browser();
    if (!browser)
      throw new Error("visualguard.check needs a browser-backed page (not a persistent context).");
    let dom: DomSnapshot | undefined;
    const outcome = await capturePage({
      browser,
      config,
      job,
      env: "production",
      afterScreenshot: async (productionPage) => {
        dom = await captureDomSnapshot(productionPage).catch(() => undefined);
      },
    });
    writeFileSync(productionPath, outcome.png);
    if (dom) writeFileSync(join(dir, "production.dom.json"), JSON.stringify(dom));
    captures.production = {
      source: "live",
      image: productionPath,
      size: outcome.size,
      durationMs: outcome.durationMs,
      attempts: outcome.attempts,
      health: outcome.health,
    } satisfies CaptureResult;
  } else if (existsSync(baselinePath) && !updating) {
    copyFileSync(baselinePath, productionPath);
    if (existsSync(baselinePath.replace(/\.png$/, ".dom.json"))) {
      copyFileSync(baselinePath.replace(/\.png$/, ".dom.json"), join(dir, "production.dom.json"));
    }
    captures.production = {
      source: "baseline",
      image: productionPath,
      size: pngSize(readFileSync(productionPath)),
      durationMs: 0,
      attempts: 0,
      health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
    };
  } else {
    mkdirSync(baselineDir, { recursive: true });
    copyFileSync(stagingPath, baselinePath);
    copyFileSync(join(dir, "staging.dom.json"), baselinePath.replace(/\.png$/, ".dom.json"));
    testInfo.annotations.push({
      type: "visualguard",
      description: `${updating ? "Updated" : "Saved"} baseline ${baselinePath}`,
    });
    return {
      id,
      route: job.route,
      name,
      viewport: job.viewport,
      status: "pass",
      urls: job.urls,
      captures,
      regions: [],
      durationMs: Date.now() - started,
    };
  }

  const diff = computeDiff({ productionPath, stagingPath, outDir: dir, options: config.diff });
  const result: JobResult = {
    id,
    route: job.route,
    name,
    viewport: job.viewport,
    status: diff.passed ? "pass" : "review",
    urls: job.urls,
    captures,
    diff: {
      width: diff.width,
      height: diff.height,
      sizeMismatch: diff.sizeMismatch,
      diffPixels: diff.diffPixels,
      diffRatio: diff.diffRatio,
      image: diff.image,
      shift: diff.shift,
    },
    regions: diff.regions.map((region, index) => ({
      id: index,
      kind: region.kind === "shift" ? "shift" : undefined,
      box: region.box,
      diffPixels: region.diffPixels,
      crops: region.crops,
      elements: [],
      deltas: [],
    })),
    durationMs: 0,
  };
  const findings = healthFindings(captures);
  let visual: "pass" | "review" | "regression" = diff.passed ? "pass" : "review";
  if (!diff.passed) {
    const classified = classifyJob({
      diff: result.diff!,
      regions: result.regions,
      production: readDom(join(dir, "production.dom.json")),
      staging: readDom(join(dir, "staging.dom.json")),
    });
    result.regions = classified.regions;
    findings.unshift(...classified.findings);
    visual = classified.status;
  }
  result.findings = findings.length > 0 ? findings : undefined;
  result.status = applyFindings(visual, findings);
  result.durationMs = Date.now() - started;

  await testInfo.attach(`visualguard ${name}: production`, {
    path: productionPath,
    contentType: "image/png",
  });
  await testInfo.attach(`visualguard ${name}: staging`, {
    path: stagingPath,
    contentType: "image/png",
  });
  if (diff.image)
    await testInfo.attach(`visualguard ${name}: diff`, {
      path: diff.image,
      contentType: "image/png",
    });

  const failOn = options.failOn ?? defaults.failOn ?? "regression";
  if (isFailing(result.status, failOn)) {
    const reasons = (result.findings ?? [])
      .filter((item) => item.severity !== "info")
      .map((item) => `  - ${item.message}`);
    throw new Error(
      `VisualGuard: "${name}" on ${job.route} is a ${result.status} (${(diff.diffRatio * 100).toFixed(2)}% of pixels changed)\n${reasons.join("\n")}`,
    );
  }
  return result;
}

/**
 * Playwright Test with a `visualguard` fixture (PLAN.md §19, Phase 9):
 *
 *   import { test } from "visualguard/playwright";
 *   test("checkout", async ({ page, visualguard }) => {
 *     await page.goto("/checkout");
 *     await visualguard.check(page, { name: "summary" });
 *   });
 */
export const test = base.extend<{
  visualguard: VisualGuardFixture;
  visualguardOptions: VisualGuardOptions;
  visualguardConfig: ResolvedConfig;
}>({
  // Test-scoped so `test.use({ visualguardOptions })` works in describe blocks too.
  visualguardOptions: [{}, { option: true }],
  visualguardConfig: async ({ visualguardOptions }, use) => {
    const cwd = process.cwd();
    loadEnvFiles(cwd);
    const loaded = await loadConfig({ cwd, configPath: visualguardOptions.configPath });
    const merged = visualguardOptions.config
      ? parseConfig({ ...loaded.config, ...visualguardOptions.config })
      : loaded.config;
    await use(resolveConfig(merged, { cwd, configPath: loaded.configPath }));
  },
  visualguard: async ({ visualguardConfig, visualguardOptions }, use, testInfo) => {
    await use({
      check: (page, options = {}) =>
        check(visualguardConfig, page, options, visualguardOptions, testInfo),
    });
  },
});

export { expect };
export type { JobResult, FailOn };
