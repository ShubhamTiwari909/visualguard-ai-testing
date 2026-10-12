/**
 * @file Browser-side stability helpers: CSS, network tracking, fonts, lazy-load scrolling,
 * image readiness and media/page metrics.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Page, Request } from "playwright";
import { sleep, withTimeout } from "../core/util.js";

/**
 * Common cookie-consent banners and chat widgets, hidden when `stabilize.hideDefaults` is on.
 */
export const DEFAULT_HIDE_SELECTORS = [
  "#onetrust-consent-sdk",
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  "#truste-consent-track",
  ".osano-cm-window",
  ".cc-window",
  "#cookie-law-info-bar",
  "#hubspot-messages-iframe-container",
  "#intercom-container",
  ".intercom-lightweight-app",
  "#crisp-chatbox",
  "#drift-frame-controller",
  "#drift-frame-chat",
  ".zEWidget-launcher",
  "#launcher[title*='Zendesk']",
];

/**
 * Developers mark dynamic elements in their own markup: `data-visualguard-ignore` masks the
 * element (it keeps its size, painted in a solid colour on both sides) and
 * `data-visualguard-ignore="hide"` hides it.
 */
export const IGNORE_MASK_SELECTOR =
  '[data-visualguard-ignore]:not([data-visualguard-ignore="hide"])';
export const IGNORE_HIDE_SELECTOR = '[data-visualguard-ignore="hide"]';

/**
 * Build CSS rules that reduce motion and hide configured elements while preserving their layout
 * space. Joining the rules produces one stylesheet that can be injected before capture.
 */
export function stabilizationCSS(options: {
  disableAnimations: boolean;
  hide: readonly string[];
}): string {
  const rules: string[] = [
    // Hide scrollbars. Chromium also hides them through CDP (see hideScrollbars); the
    // ::-webkit-scrollbar rule is left out on purpose because it makes full-page screenshots
    // of overflowing pages unstable.
    "html { scrollbar-width: none !important; }",
    "* { caret-color: transparent !important; }",
  ];
  if (options.disableAnimations) {
    rules.push(
      `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }`,
    );
  }
  if (options.hide.length > 0) {
    rules.push(`${options.hide.join(",\n")} { visibility: hidden !important; }`);
  }
  return rules.join("\n");
}

const UNTRACKED_RESOURCE_TYPES = new Set(["websocket", "eventsource"]);

/**
 * Tracks in-flight requests so we can wait for a quiet network window.
 */
export class NetworkTracker {
  private readonly inflight = new Set<Request>();
  private lastChange = Date.now();

  /**
   * Track relevant network requests in a Set and remember when the tracked set changes.
   * Register finish/failure handlers so requests leave the set regardless of their outcome.
   */
  constructor(page: Page) {
    page.on("request", (request) => {
      if (UNTRACKED_RESOURCE_TYPES.has(request.resourceType())) return;
      this.inflight.add(request);
      this.lastChange = Date.now();
    });
    /**
     * Remove a completed or failed request and update the quiet-period timestamp only if it was
     * tracked. Set.delete returns whether an entry was actually removed.
     */
    const done = (request: Request) => {
      if (this.inflight.delete(request)) this.lastChange = Date.now();
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  }

  /**
   * Waits until no request has been in flight for `quietMs`. Returns false if `timeoutMs`
   * passes first (long-polling, analytics beacons), in which case the capture continues anyway.
   *
   * Poll until no tracked request has been active for the requested quiet period. Return false
   * at the deadline so endless analytics or long polling cannot block capture forever.
   */
  async waitForQuiet(quietMs: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastChange >= quietMs) return true;
      await sleep(25);
    }
    return false;
  }
}

/**
 * Wait for browser fonts to be ready, with a bounded fallback. Font completion is a browser
 * Promise; withTimeout prevents it from holding the Node capture indefinitely.
 */
export async function waitForFonts(page: Page, timeoutMs = 5_000): Promise<void> {
  await withTimeout(
    page.evaluate(() => document.fonts?.ready.then(() => true)).catch(() => false),
    timeoutMs,
    false,
  );
}

/**
 * Scrolls through the page one viewport at a time so lazy content loads, then back to the top.
 *
 * Scroll down in viewport-sized steps to trigger lazy content, then return to the top. The
 * evaluated callback runs in the browser and receives the height limit as an explicit argument.
 */
export async function scrollThrough(page: Page, maxHeight: number): Promise<void> {
  await page.evaluate(async (limitHeight) => {
    const step = Math.max(200, window.innerHeight);
    const limit = Math.min(document.documentElement.scrollHeight, limitHeight);
    for (let y = 0; y < limit; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  }, maxHeight);
}

/**
 * Wait for unfinished images to emit either load or error, subject to the outer timeout. An
 * error also finishes the wait because a broken image will not later emit a successful load.
 */
export async function waitForImages(page: Page, timeoutMs = 5_000): Promise<void> {
  await withTimeout(
    page
      .evaluate(() =>
        Promise.all(
          Array.from(document.images)
            .filter((img) => !img.complete)
            .map(
              (img) =>
                new Promise((resolve) => {
                  img.addEventListener("load", resolve, { once: true });
                  img.addEventListener("error", resolve, { once: true });
                }),
            ),
        ).then(() => true),
      )
      .catch(() => false),
    timeoutMs,
    false,
  );
}

/**
 * Pauses videos and SVG (SMIL) animations at their first frame.
 *
 * Reset video and SVG animations to a stable first frame inside the page. Catch unsupported
 * browser operations so optional stabilization does not abort capture.
 */
export async function pauseMedia(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      for (const video of Array.from(document.querySelectorAll("video"))) {
        video.pause();
        video.currentTime = 0;
      }
      for (const svg of Array.from(document.querySelectorAll("svg"))) {
        svg.pauseAnimations?.();
        svg.setCurrentTime?.(0);
      }
    })
    .catch(() => {});
}

/**
 * Hides classic and overlay scrollbars in Chromium, which CSS alone does not do reliably.
 *
 * Use Chromium's debugging protocol to hide scrollbars that CSS alone may leave visible. Other
 * engines skip this optional step and keep their CSS fallback.
 */
export async function hideScrollbars(page: Page, browserName: string): Promise<void> {
  if (browserName !== "chromium") return;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setScrollbarsHidden", { hidden: true });
  } catch {
    // Not available in this browser build; the CSS fallback still applies.
  }
}

export interface PageMetrics {
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  brokenImages: string[];
}

/**
 * Measure document dimensions and identify loaded images with no decoded width. Run inside the
 * browser because Node.js cannot directly inspect document.images or page geometry.
 */
export async function readPageMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      documentWidth: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
      documentHeight: Math.max(root.scrollHeight, body?.scrollHeight ?? 0),
      viewportWidth: window.innerWidth,
      brokenImages: Array.from(document.images)
        .filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src))
        .map((img) => img.currentSrc || img.src),
    };
  });
}
