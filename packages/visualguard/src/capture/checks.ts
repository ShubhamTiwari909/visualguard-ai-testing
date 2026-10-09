import type { Page } from "playwright";
import { withTimeout } from "../core/util.js";
import type { A11yViolation, PerfMetrics } from "../core/types.js";

let axeSource: string | undefined;

async function loadAxe(): Promise<string> {
  axeSource ??= ((await import("axe-core")) as unknown as { default: { source: string } }).default
    .source;
  return axeSource;
}

/**
 * Runs axe-core on the loaded page (`checks.accessibility`). Frames are skipped: axe would wait
 * for an answer from every iframe it wasn't injected into.
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
 * Keeps the browser's own `performance.getEntriesByType`: Playwright's fake clock replaces it with
 * one that returns nothing. Must be added before the clock is installed.
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
 */
export async function readPerformance(page: Page): Promise<PerfMetrics> {
  return page.evaluate(async () => {
    const entriesByType: (type: string) => PerformanceEntryList =
      (window as unknown as { __visualguardEntries?: Performance["getEntriesByType"] })
        .__visualguardEntries ?? performance.getEntriesByType.bind(performance);
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
    const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
    const transfer = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    const js = resources
      .filter((entry) => entry.initiatorType === "script" || /\.m?js(\?|$)/.test(entry.name))
      .reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    const cls = shifts.reduce((sum, entry) => {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      return shift.hadRecentInput ? sum : sum + shift.value;
    }, 0);
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
