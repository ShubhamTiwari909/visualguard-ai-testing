/**
 * @file Injects/runs axe accessibility checks and preserves/reads browser performance
 * timing/resource metrics.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Page } from "playwright";
import { withTimeout } from "../core/util.js";
import type { A11yViolation, PerfMetrics } from "../core/types.js";

let axeSource: string | undefined;

/**
 * Lazily import and cache the axe-core browser script. The nullish assignment operator ??=
 * fills the cached value only when it has not already been set.
 */
async function loadAxe(): Promise<string> {
  axeSource ??= ((await import("axe-core")) as unknown as { default: { source: string } }).default
    .source;
  return axeSource;
}

/**
 * Runs axe-core on the loaded page (`checks.accessibility`). Frames are skipped: axe would wait
 * for an answer from every iframe it wasn't injected into.
 *
 * Inject axe into the page and collect a compact list of violations within a timeout. The
 * evaluated callback executes in the browser, so it reads window/document rather than Node.js
 * state.
 */
export async function runAccessibilityCheck(
  page: Page,
  options: { tags: readonly string[]; timeoutMs?: number },
): Promise<A11yViolation[]> {
  const source = await loadAxe();
  await page.evaluate(source);
  const run = page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
    const result: import("axe-core").AxeResults = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
      resultTypes: ["violations"],
      iframes: false,
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? "minor",
      help: violation.help,
      helpUrl: violation.helpUrl,
      count: violation.nodes.length,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
  }, options.tags as string[]);
  const violations = await withTimeout(run, options.timeoutMs ?? 30_000, undefined);
  if (!violations) throw new Error("axe-core did not finish in time");
  return violations as A11yViolation[];
}

/**
 * Keeps the browser's own `performance.getEntriesByType`: Playwright's fake clock replaces it
 * with one that returns nothing. Must be added before the clock is installed.
 *
 * Save the browser's real performance-entry reader before Playwright installs a fake clock.
 * addInitScript runs in new documents before the application scripts.
 */
export async function preservePerformanceTimeline(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const entries = performance.getEntriesByType.bind(performance);
    Object.defineProperty(window, "__visualguardEntries", { value: entries });
  });
}

/**
 * Load metrics from the browser's performance timeline (`checks.performance`), read once the
 * network is quiet and before VisualGuard changes the page. Byte counts only include responses
 * the page may measure (same origin, or cross-origin with Timing-Allow-Origin).
 *
 * Read navigation/resource/paint evidence inside the page and normalize it into report metrics.
 * Browser visibility rules can hide cross-origin timing data, so these values describe
 * observable resources.
 */
export async function readPerformance(page: Page): Promise<PerfMetrics> {
  return page.evaluate(async () => {
    const entriesByType: (type: string) => PerformanceEntryList =
      (window as unknown as { __visualguardEntries?: Performance["getEntriesByType"] })
        .__visualguardEntries ?? performance.getEntriesByType.bind(performance);
    /**
     * Collect already-buffered performance entries and entries delivered during a short
     * observer window. Disconnect before resolving to release the browser observer; unsupported
     * entry types produce an empty list.
     */
    const buffered = (type: string) =>
      new Promise<PerformanceEntry[]>((resolve) => {
        const entries: PerformanceEntry[] = [];
        try {
          const observer = new PerformanceObserver((list) => {
            entries.push(...list.getEntries());
          });
          observer.observe({ type, buffered: true });
          // Buffered entries arrive in the next task.
          setTimeout(() => {
            entries.push(...observer.takeRecords());
            observer.disconnect();
            resolve(entries);
          }, 50);
        } catch {
          resolve(entries);
        }
      });
    const [lcp, shifts] = await Promise.all([
      buffered("largest-contentful-paint"),
      buffered("layout-shift"),
    ]);
    const navigation = entriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = entriesByType("paint").find((entry) => entry.name === "first-contentful-paint");
    const resources = entriesByType("resource") as PerformanceResourceTiming[];
    /**
     * Convert bytes to kilobytes and round to one decimal place. Dividing by 102.4 and then by
     * 10 is equivalent to bytes / 1024 rounded to tenths.
     */
    const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
    const transfer = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    const js = resources
      .filter((entry) => entry.initiatorType === "script" || /\.m?js(\?|$)/.test(entry.name))
      .reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    const cls = shifts.reduce((sum, entry) => {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      return shift.hadRecentInput ? sum : sum + shift.value;
    }, 0);
    /**
     * Round a present measurement to an integer while preserving undefined. Unknown timing data
     * must remain unknown rather than turn into zero.
     */
    const round = (value: number | undefined) =>
      value === undefined ? undefined : Math.round(value);
    return {
      ttfbMs: round(navigation?.responseStart),
      fcpMs: round(paint?.startTime),
      lcpMs: round(lcp.at(-1)?.startTime),
      cls: Math.round(cls * 1000) / 1000,
      loadMs: round(navigation?.loadEventEnd || undefined),
      requests: resources.length + 1,
      transferKB: kb(transfer + (navigation?.transferSize ?? 0)),
      jsKB: kb(js),
      domNodes: document.getElementsByTagName("*").length,
    };
  });
}
