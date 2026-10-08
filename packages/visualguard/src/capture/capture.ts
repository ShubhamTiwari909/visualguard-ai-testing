import type { Browser, Page } from "playwright";
import type { ResolvedConfig } from "../config/resolve.js";
import type { CaptureHookContext } from "../config/schema.js";
import { errorMessage } from "../core/errors.js";
import type { Env, HealthSignals, JobSpec, Size } from "../core/types.js";
import { pngSize, sleep } from "../core/util.js";
import { decodePNG } from "../diff/image.js";
import { createContext } from "./browser.js";
import {
  DEFAULT_HIDE_SELECTORS,
  hideScrollbars,
  NetworkTracker,
  pauseMedia,
  readPageMetrics,
  scrollThrough,
  stabilizationCSS,
  waitForFonts,
  waitForImages,
} from "./stabilize.js";

export interface CaptureRequest {
  browser: Browser;
  config: ResolvedConfig;
  job: JobSpec;
  env: Env;
  /** Called with the stabilised page right after the screenshot (DOM snapshots, Phase 4). */
  afterScreenshot?: (page: Page) => Promise<void>;
  /** Save a Playwright trace of the final attempt here. */
  tracePath?: string;
}

export interface CaptureOutcome {
  png: Buffer;
  size: Size;
  truncated: boolean;
  unstable: boolean;
  attempts: number;
  durationMs: number;
  health: HealthSignals;
}

const MASK_COLOR = "#FF00FF";
const STABLE_PIXEL_TOLERANCE = 10;

function countChangedPixels(a: Buffer, b: Buffer): number {
  const imageA = decodePNG(a);
  const imageB = decodePNG(b);
  if (imageA.width !== imageB.width || imageA.height !== imageB.height)
    return Number.POSITIVE_INFINITY;
  let changed = 0;
  for (let i = 0; i < imageA.data.length; i += 4) {
    if (
      imageA.data[i] !== imageB.data[i] ||
      imageA.data[i + 1] !== imageB.data[i + 1] ||
      imageA.data[i + 2] !== imageB.data[i + 2]
    ) {
      changed++;
    }
  }
  return changed;
}

/**
 * Captures one page with retries. Throws the last error if every attempt fails.
 *
 * Every attempt gets its own browser context: Playwright's clock belongs to the context, so
 * pausing it for one page would freeze any other page sharing that context. Separate contexts
 * also keep cookies and storage from leaking between routes.
 */
export async function capturePage(request: CaptureRequest): Promise<CaptureOutcome> {
  const started = Date.now();
  const attempts = request.config.stabilize.retries + 1;
  const viewport = request.config.viewports[request.job.viewport]!;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const context = await createContext(request.browser, request.config, request.env, viewport);
    if (request.tracePath) await context.tracing.start({ screenshots: true, snapshots: true });
    try {
      const page = await context.newPage();
      await hideScrollbars(page, request.config.browser.name);
      const outcome = await captureOnce(page, request);
      return { ...outcome, attempts: attempt, durationMs: Date.now() - started };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    } finally {
      if (request.tracePath)
        await context.tracing.stop({ path: request.tracePath }).catch(() => {});
      await context.close().catch(() => {});
    }
  }
  throw new Error(`Capture failed after ${attempts} attempt(s): ${errorMessage(lastError)}`, {
    cause: lastError,
  });
}

async function captureOnce(
  page: Page,
  { config, job, env, afterScreenshot }: CaptureRequest,
): Promise<Omit<CaptureOutcome, "attempts" | "durationMs">> {
  const { stabilize } = config;
  const url = job.urls[env];
  const health: HealthSignals = { consoleErrors: [], failedRequests: [], brokenImages: [] };

  page.on("console", (message) => {
    if (message.type() === "error") health.consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", (error) => health.consoleErrors.push(error.message.slice(0, 500)));
  page.on("requestfailed", (failed) => {
    const reason = failed.failure()?.errorText ?? "failed";
    if (reason.includes("ERR_BLOCKED_BY_CLIENT")) return; // blocked on purpose
    health.failedRequests.push(`${reason} ${failed.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      health.failedRequests.push(`${response.status()} ${response.url()}`);
  });

  const network = new NetworkTracker(page);
  const hookContext = { page, env, route: job.route, url, viewport: job.viewport };

  // The clock runs normally while the page loads and is paused just before the screenshot.
  // The clock's internal time starts at `clockBase` and then follows real time.
  const clockBase = stabilize.freezeTime ? new Date(stabilize.freezeTime).getTime() : Date.now();
  const installedAt = Date.now();
  if (stabilize.pauseClock || stabilize.freezeTime) {
    await page.clock.install({ time: clockBase });
  }
  if (stabilize.freezeTime) await page.clock.setFixedTime(new Date(stabilize.freezeTime));
  await config.hooks.beforeNavigate?.(hookContext);

  const response = await page.goto(url, { waitUntil: "load" });
  health.status = response?.status();
  health.finalURL = page.url();

  const shot = await stabilizeAndShoot(page, {
    config,
    job,
    health,
    network,
    clock: stabilize.pauseClock ? { base: clockBase, installedAt } : undefined,
    hookContext,
  });

  await afterScreenshot?.(page);
  return { ...shot, health };
}

export interface ShootContext {
  config: ResolvedConfig;
  job: Pick<JobSpec, "viewport" | "waitFor" | "mask" | "hide">;
  /** Filled in with broken images and overflow. */
  health: HealthSignals;
  /** Present when the tracker was attached before navigation. */
  network?: NetworkTracker;
  /** Present when the page clock was installed before navigation, so it can be paused. */
  clock?: { base: number; installedAt: number };
  hookContext: CaptureHookContext;
}

/**
 * Stabilises a loaded page and takes the screenshot (PLAN.md §7): stabilisation CSS, fonts,
 * lazy content, images, network, hooks, media and clock, then a stability loop. Also used by the
 * Playwright fixture on pages a test has already navigated.
 */
export async function stabilizeAndShoot(
  page: Page,
  { config, job, health, network, clock, hookContext }: ShootContext,
): Promise<{ png: Buffer; size: Size; truncated: boolean; unstable: boolean }> {
  const { stabilize, screenshot } = config;
  const hide = [
    ...(stabilize.hideDefaults ? DEFAULT_HIDE_SELECTORS : []),
    ...stabilize.hide,
    ...job.hide,
  ];
  await page.addStyleTag({
    content: stabilizationCSS({ disableAnimations: stabilize.disableAnimations, hide }),
  });

  if (job.waitFor) await page.waitForSelector(job.waitFor, { state: "visible" });
  if (stabilize.waitForFonts) await waitForFonts(page);
  if (stabilize.scrollToLoad) await scrollThrough(page, screenshot.maxHeight);
  await waitForImages(page);
  if (network)
    await network.waitForQuiet(stabilize.networkQuietMs, stabilize.networkQuietTimeoutMs);
  else
    await page
      .waitForLoadState("networkidle", { timeout: stabilize.networkQuietTimeoutMs })
      .catch(() => {});
  await config.hooks.beforeCapture?.(hookContext);
  if (stabilize.pauseMedia) await pauseMedia(page);
  if (clock) await pauseClock(page, clock.base, clock.installedAt);

  const metrics = await readPageMetrics(page);
  health.brokenImages = metrics.brokenImages;
  // Compare with the configured width: mobile emulation widens the layout viewport to fit
  // overflowing content, so window.innerWidth can hide the overflow.
  const viewportWidth = config.viewports[job.viewport]?.width ?? metrics.viewportWidth;
  if (metrics.documentWidth > viewportWidth + 1) {
    health.horizontalOverflow = { documentWidth: metrics.documentWidth, viewportWidth };
  }

  const truncated = screenshot.fullPage && metrics.documentHeight > screenshot.maxHeight;
  const mask = [...stabilize.mask, ...job.mask].map((selector) => page.locator(selector));
  const shoot = () =>
    page.screenshot({
      type: "png",
      fullPage: screenshot.fullPage,
      animations: stabilize.disableAnimations ? "disabled" : "allow",
      caret: "hide",
      scale: "css",
      mask,
      maskColor: MASK_COLOR,
      clip: truncated
        ? { x: 0, y: 0, width: metrics.documentWidth, height: screenshot.maxHeight }
        : undefined,
    });

  // Stability loop: keep shooting until two consecutive screenshots match.
  let png = await shoot();
  let previous = png;
  let unstable = true;
  for (let attempt = 1; attempt < stabilize.stabilityAttempts + 1; attempt++) {
    await sleep(stabilize.stabilityIntervalMs);
    const next = await shoot();
    previous = png;
    png = next;
    if (next.equals(previous)) {
      unstable = false;
      break;
    }
  }
  // Chromium sometimes re-rasterises a few anti-aliased pixels outside the viewport between
  // shots; that is not a moving page.
  if (unstable && countChangedPixels(previous, png) <= STABLE_PIXEL_TOLERANCE) unstable = false;

  return { png, size: pngSize(png), truncated, unstable };
}

/**
 * Stops timers and requestAnimationFrame, which CSS overrides cannot reach. The pause time must
 * not be behind the clock's internal time, so it is derived from when the clock was installed.
 */
async function pauseClock(page: Page, clockBase: number, installedAt: number): Promise<void> {
  for (const margin of [100, 1_000, 5_000]) {
    try {
      await page.clock.pauseAt(clockBase + (Date.now() - installedAt) + margin);
      return;
    } catch (error) {
      if (!/past/i.test(errorMessage(error))) throw error;
    }
  }
  // Could not pause; the stability loop will still catch moving content.
}
