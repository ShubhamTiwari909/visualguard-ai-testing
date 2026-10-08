import type { Browser, Page } from "playwright";
import type { ResolvedConfig } from "../config/resolve.js";
import { errorMessage } from "../core/errors.js";
import type { Env, HealthSignals, JobSpec, Size } from "../core/types.js";
import { pngSize, sleep } from "../core/util.js";
import { createContext } from "./browser.js";
import {
  DEFAULT_HIDE_SELECTORS,
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
  const { stabilize, screenshot } = config;
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
  await network.waitForQuiet(stabilize.networkQuietMs, stabilize.networkQuietTimeoutMs);
  await config.hooks.beforeCapture?.(hookContext);
  if (stabilize.pauseMedia) await pauseMedia(page);
  if (stabilize.pauseClock) await pauseClock(page, clockBase, installedAt);

  const metrics = await readPageMetrics(page);
  health.brokenImages = metrics.brokenImages;
  if (metrics.documentWidth > metrics.viewportWidth) {
    health.horizontalOverflow = {
      documentWidth: metrics.documentWidth,
      viewportWidth: metrics.viewportWidth,
    };
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
  let unstable = true;
  for (let attempt = 1; attempt < stabilize.stabilityAttempts + 1; attempt++) {
    await sleep(stabilize.stabilityIntervalMs);
    const next = await shoot();
    if (next.equals(png)) {
      unstable = false;
      break;
    }
    png = next;
  }

  await afterScreenshot?.(page);
  return { png, size: pngSize(png), truncated, unstable, health };
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
