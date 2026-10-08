import type { Page, Request } from "playwright";
import { sleep, withTimeout } from "../core/util.js";

/** Common cookie-consent banners and chat widgets, hidden when `stabilize.hideDefaults` is on. */
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

export function stabilizationCSS(options: {
  disableAnimations: boolean;
  hide: readonly string[];
}): string {
  const rules: string[] = [
    // Hide scrollbars so classic and overlay scrollbars render the same.
    "html { scrollbar-width: none !important; }",
    "::-webkit-scrollbar { display: none !important; }",
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

/** Tracks in-flight requests so we can wait for a quiet network window. */
export class NetworkTracker {
  private readonly inflight = new Set<Request>();
  private lastChange = Date.now();

  constructor(page: Page) {
    page.on("request", (request) => {
      if (UNTRACKED_RESOURCE_TYPES.has(request.resourceType())) return;
      this.inflight.add(request);
      this.lastChange = Date.now();
    });
    const done = (request: Request) => {
      if (this.inflight.delete(request)) this.lastChange = Date.now();
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  }

  /**
   * Waits until no request has been in flight for `quietMs`. Returns false if `timeoutMs` passes
   * first (long-polling, analytics beacons), in which case the capture continues anyway.
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

export async function waitForFonts(page: Page, timeoutMs = 5_000): Promise<void> {
  await withTimeout(
    page.evaluate(() => document.fonts?.ready.then(() => true)).catch(() => false),
    timeoutMs,
    false,
  );
}

/** Scrolls through the page one viewport at a time so lazy content loads, then back to the top. */
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

/** Pauses videos and SVG (SMIL) animations at their first frame. */
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

export interface PageMetrics {
  documentWidth: number;
  documentHeight: number;
  viewportWidth: number;
  brokenImages: string[];
}

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
