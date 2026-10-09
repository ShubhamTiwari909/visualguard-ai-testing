/**
 * @file Playwright fixture entry: extends test/page, loads config, checks interactive state
 * against production/baselines and attaches evidence.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { capturePage, stabilizeAndShoot } from "../capture/capture.js";
import { captureDomSnapshot } from "../capture/dom-snapshot.js";
import { loadConfig, loadEnvFiles, parseConfig } from "../config/load.js";
import { resolveConfig, type ResolvedConfig } from "../config/resolve.js";
import type { VisualGuardConfig } from "../config/schema.js";
import { routeSlug } from "../config/urls.js";
import { classifyComparison } from "../core/comparison.js";
import { applyAccepted, readAccepted } from "../core/accepted.js";
import { AnalysisSession, needsAnalysis } from "../ai/analyze-job.js";
import { createProvider } from "../ai/factory.js";
import {
  assertBaselineCompatible,
  capturePolicy,
  fingerprint,
  renderingIdentity,
  writeBaselineMetadata,
} from "../core/provenance.js";
import { instrumentHealth } from "../capture/health.js";
import {
  preservePerformanceTimeline,
  readPerformance,
  runAccessibilityCheck,
} from "../capture/checks.js";
import { isFailing } from "../core/status.js";
import type { CaptureResult, FailOn, HealthSignals, JobResult, JobSpec } from "../core/types.js";
import { pngSize } from "../core/util.js";
import { computeDiff } from "../diff/compute.js";

const pageHealth = new WeakMap<Page, HealthSignals>();

export interface VisualGuardOptions {
  /**
   * Instrument the test-owned page before navigation.
   */
  collectHealth?: boolean;
  /**
   * Path to a config file (default: visualguard.config.* in the working directory).
   */
  configPath?: string;
  /**
   * Inline config, merged over the file.
   */
  config?: VisualGuardConfig;
  /**
   * What fails the test (default "regression").
   */
  failOn?: FailOn;
}

export interface CheckOptions {
  /**
   * Bring a fresh production page to the same interactive state as the test page.
   */
  referenceSetup?: (page: Page) => Promise<void>;
  /**
   * Name for this check, unique within the test (default "page").
   */
  name?: string;
  waitFor?: string;
  mask?: string[];
  hide?: string[];
  failOn?: FailOn;
}

export interface VisualGuardFixture {
  /**
   * Compares the page as it is now with production (same path on baseURL.production), or with a
   * stored baseline when there's no production URL. Fails the test per `failOn`.
   */
  check(page: Page, options?: CheckOptions): Promise<JobResult>;
}

/**
 * Map the current test page URL to the production origin while preserving its
 * route/query/fragment and configured prefix. This chooses the reference page for the
 * Playwright fixture.
 */
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

/**
 * Capture an already-navigated Playwright test page, obtain its reference and classify the
 * comparison. Attach artifacts/results to testInfo and fail according to the configured policy.
 */
async function check(
  baseConfig: ResolvedConfig,
  page: Page,
  options: CheckOptions,
  defaults: VisualGuardOptions,
  testInfo: TestInfo,
  session?: AnalysisSession,
): Promise<JobResult> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const config: ResolvedConfig = {
    ...baseConfig,
    browser: {
      ...baseConfig.browser,
      name: testInfo.project.use.browserName ?? "chromium",
      locale: testInfo.project.use.locale ?? baseConfig.browser.locale,
      timezoneId: testInfo.project.use.timezoneId ?? baseConfig.browser.timezoneId,
      colorScheme: testInfo.project.use.colorScheme ?? baseConfig.browser.colorScheme,
    },
    viewports: {
      playwright: {
        ...size,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor ?? 1,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
      },
    },
  };
  const name = options.name ?? "page";
  const current = new URL(page.url());
  const id = `${routeSlug(testInfo.titlePath.slice(1).join(" ").replace(/\s+/g, "-"))}__${routeSlug(`/${name}`)}-${fingerprint({ file: relative(config.cwd, testInfo.file), title: testInfo.titlePath, name, project: testInfo.project.name, browser: config.browser.name, viewport: config.viewports.playwright }).slice(0, 12)}`;
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
  const health: HealthSignals = structuredClone(
    pageHealth.get(page) ?? { consoleErrors: [], failedRequests: [], brokenImages: [] },
  );
  const hookContext = {
    page,
    env: "staging" as const,
    route: job.route,
    url: current.href,
    viewport: job.viewport,
  };
  const started = Date.now();
  if (config.checks.performance.enabled) {
    try {
      health.performance = await readPerformance(page);
    } catch (error) {
      (health.checkErrors ??= []).push(`performance: ${String(error)}`);
    }
  }
  const shot = await stabilizeAndShoot(page, { config, job, health, hookContext });
  if (config.checks.accessibility.enabled) {
    try {
      health.accessibility = await runAccessibilityCheck(page, {
        tags: config.checks.accessibility.tags,
      });
    } catch (error) {
      (health.checkErrors ??= []).push(`accessibility: ${String(error)}`);
    }
  }
  /**
   * Convert an artifact path to the fixture's portable relative path. Forward slashes are used
   * in serialized results and reports.
   */
  const rel = (path: string) => relative(dir, path).split("\\").join("/");
  const stagingPath = join(dir, "staging.png");
  writeFileSync(stagingPath, shot.png);
  writeFileSync(join(dir, "staging.dom.json"), JSON.stringify(await captureDomSnapshot(page)));
  const captures: JobResult["captures"] = {
    staging: {
      source: "live",
      image: "staging.png",
      dom: "staging.dom.json",
      unstable: shot.unstable,
      truncated: shot.truncated,
      size: shot.size,
      durationMs: Date.now() - started,
      attempts: 1,
      health,
    },
  };

  // The reference: production, or a stored baseline.
  const productionPath = join(dir, "production.png");
  const baselineDir = resolve(config.cwd, config.baseline.dir, "playwright");
  const identity = renderingIdentity(config, job, testInfo.project.name);
  const baselinePath = join(baselineDir, `${id}.png`);
  const updating =
    testInfo.config.updateSnapshots === "all" ||
    testInfo.config.updateSnapshots === "changed" ||
    Boolean(process.env.VISUALGUARD_UPDATE_BASELINES);
  /**
   * Capture the corresponding production page in an isolated context and optionally save its
   * DOM evidence. Reuse the test page's browser engine while keeping authentication/storage
   * sessions separate.
   */
  const captureReference = async (saveDom = true) => {
    const browser = page.context().browser();
    if (!browser) throw new Error("visualguard.check needs a browser-backed page.");
    return capturePage({
      browser,
      config,
      job,
      env: "production",
      setup: options.referenceSetup,
      /**
       * Save optional reference DOM evidence after the production screenshot. Catch snapshot
       * errors so the captured image remains usable.
       */
      afterScreenshot: async (reference) => {
        if (!saveDom) return;
        await captureDomSnapshot(reference)
          .then((dom) => writeFileSync(join(dir, "production.dom.json"), JSON.stringify(dom)))
          .catch(() => {});
      },
    });
  };
  if (config.baseURL.production) {
    const outcome = await captureReference();
    writeFileSync(productionPath, outcome.png);
    captures.production = {
      source: "live",
      image: "production.png",
      dom: existsSync(join(dir, "production.dom.json")) ? "production.dom.json" : undefined,
      size: outcome.size,
      durationMs: outcome.durationMs,
      attempts: outcome.attempts,
      health: outcome.health,
    } satisfies CaptureResult;
  } else if (existsSync(baselinePath) && !updating) {
    assertBaselineCompatible(baselinePath, identity, config.baseline.legacy);
    copyFileSync(baselinePath, productionPath);
    if (existsSync(baselinePath.replace(/\.png$/, ".dom.json"))) {
      copyFileSync(baselinePath.replace(/\.png$/, ".dom.json"), join(dir, "production.dom.json"));
    }
    captures.production = {
      source: "baseline",
      image: "production.png",
      dom: existsSync(join(dir, "production.dom.json")) ? "production.dom.json" : undefined,
      size: pngSize(readFileSync(productionPath)),
      durationMs: 0,
      attempts: 0,
      health: existsSync(baselinePath.replace(/\.png$/, ".health.json"))
        ? JSON.parse(readFileSync(baselinePath.replace(/\.png$/, ".health.json"), "utf8"))
        : { consoleErrors: [], failedRequests: [], brokenImages: [] },
    };
  } else {
    if (!updating && config.baseline.missing === "error")
      throw new Error(
        `Missing baseline ${baselinePath}; update snapshots explicitly or set baseline.missing: "create".`,
      );
    mkdirSync(baselineDir, { recursive: true });
    copyFileSync(stagingPath, baselinePath);
    writeBaselineMetadata(baselinePath, identity, config.cwd);
    writeFileSync(baselinePath.replace(/\.png$/, ".health.json"), JSON.stringify(health));
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

  let diff = computeDiff({ productionPath, stagingPath, outDir: dir, options: config.diff });
  if (!diff.passed && config.diff.noiseMap && config.baseURL.production) {
    const again = await captureReference(false);
    const againPath = join(dir, "production.again.png");
    writeFileSync(againPath, again.png);
    diff = computeDiff({
      productionPath,
      stagingPath,
      outDir: dir,
      options: config.diff,
      noise: { env: "production", againPath, domPath: join(dir, "production.dom.json") },
    });
  }
  let result: JobResult = {
    id,
    capturePolicy: capturePolicy(config, job),
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
      image: diff.image ? rel(diff.image) : undefined,
      noise: diff.noise ? { env: "production", ...diff.noise } : undefined,
      shift: diff.shift,
    },
    regions: diff.regions.map((region, index) => ({
      id: index,
      kind: region.kind === "shift" ? "shift" : undefined,
      box: region.box,
      diffPixels: region.diffPixels,
      crops: {
        production: rel(region.crops.production),
        staging: rel(region.crops.staging),
        diff: rel(region.crops.diff),
      },
      elements: [],
      deltas: [],
    })),
    durationMs: 0,
  };
  result = classifyComparison(result, dir, config.checks, true);
  result = applyAccepted(result, dir, readAccepted(config.acceptedPath), config.output.acceptMatch);
  if (session && needsAnalysis(result, config.ai.analyze))
    result = await session.analyze(result, dir, config.baseURL.production ? "compare" : "baseline");
  result.durationMs = Date.now() - started;

  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify({ ...result, usage: session?.budget.snapshot() }, null, 2),
  );
  await testInfo.attach(`visualguard ${name}: result`, {
    path: join(dir, "result.json"),
    contentType: "application/json",
  });
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
  /**
   * Resolve configuration for this test and supply it through Playwright's use callback. Code
   * before await use sets up the fixture; code after it would run during teardown.
   */
  visualguardConfig: async ({ visualguardOptions }, use) => {
    const cwd = process.cwd();
    loadEnvFiles(cwd);
    const loaded = await loadConfig({ cwd, configPath: visualguardOptions.configPath });
    const merged = visualguardOptions.config
      ? parseConfig({ ...loaded.config, ...visualguardOptions.config })
      : loaded.config;
    await use(resolveConfig(merged, { cwd, configPath: loaded.configPath }));
  },
  /**
   * Wrap the test page with optional health/performance instrumentation. await use(page) spans
   * the test, and finally removes listeners even when its assertions fail.
   */
  page: async ({ page, visualguardConfig, visualguardOptions }, use) => {
    const instrumentation = visualguardOptions.collectHealth ? instrumentHealth(page) : undefined;
    if (instrumentation) pageHealth.set(page, instrumentation.health);
    if (visualguardConfig.checks.performance.enabled) await preservePerformanceTimeline(page);
    try {
      await use(page);
    } finally {
      instrumentation?.dispose();
      pageHealth.delete(page);
    }
  },
  /**
   * Create a test-scoped AI session and expose the visualguard fixture through use. Tests call
   * the supplied check callback with their own navigated page.
   */
  visualguard: async ({ visualguardConfig, visualguardOptions }, use, testInfo) => {
    const { provider } = createProvider(visualguardConfig.ai);
    const session = provider
      ? new AnalysisSession(provider, visualguardConfig.ai, {
          cacheDir: join(visualguardConfig.outputDir, "cache", "ai"),
        })
      : undefined;
    await use({
      /**
       * Delegate a fixture call to the shared capture/comparison helper with this test's
       * configuration and reporting context.
       */
      check: (page, options = {}) =>
        check(visualguardConfig, page, options, visualguardOptions, testInfo, session),
    });
  },
});

export { expect };
export type { JobResult, FailOn };
