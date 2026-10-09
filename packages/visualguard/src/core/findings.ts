/**
 * @file Converts health/accessibility/performance changes into findings and raises result
 * severity without downgrading failures.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { ParsedConfig } from "../config/schema.js";
import type {
  A11yImpact,
  CaptureResult,
  Env,
  Finding,
  FindingSeverity,
  HealthSignals,
  Status,
} from "./types.js";

const RANK: Record<Status, number> = { pass: 0, accepted: 0, review: 1, regression: 2, error: 3 };

/**
 * Raises `status` to the most severe finding: findings can only make a status worse.
 *
 * Raise a job verdict to the most severe non-info finding. Comparing status ranks means
 * independent checks can worsen a result but cannot hide an existing failure.
 */
export function applyFindings(status: Status, findings: readonly Finding[]): Status {
  let result = status;
  for (const finding of findings) {
    if (finding.severity === "info") continue;
    if (RANK[finding.severity] > RANK[result]) result = finding.severity;
  }
  return result;
}

/**
 * Display a URL's path and query without its host when parsing succeeds. Return the original
 * input for non-URL failure text.
 */
function shortURL(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/**
 * Health findings from capture signals (PLAN.md §7.2). With a production capture to compare
 * against, only problems that are new on staging count; without one (scan mode), any problem is
 * worth a review.
 *
 * Turn captured browser/network/image failures into findings, comparing staging with reference
 * evidence when available. In scan mode there is no reference, so problems need review rather
 * than being assumed new regressions.
 */
export function healthFindings(
  captures: Partial<Record<Env, CaptureResult>>,
  options: { baselineHealth?: boolean; checks?: ParsedConfig["checks"] } = {},
): Finding[] {
  const staging = captures.staging?.health;
  if (!staging) return [];
  const reference =
    captures.production?.source === "live" || (options.baselineHealth && captures.production)
      ? captures.production!.health
      : undefined;
  const findings: Finding[] = [];
  /**
   * Append one health finding with the given severity and message to the local result list.
   * This closure uses the findings array owned by healthFindings.
   */
  const add = (severity: FindingSeverity, message: string) =>
    findings.push({ severity, message, source: "health" });
  const newProblem: FindingSeverity = reference ? "regression" : "review";

  if (staging.status !== undefined && staging.status >= 400) {
    if (!reference) add("review", `HTTP ${staging.status}`);
    else if (reference.status === undefined || reference.status < 400)
      add(
        "regression",
        `HTTP ${staging.status} on staging (production: ${reference.status ?? "?"})`,
      );
    else add("info", `HTTP ${staging.status} on both environments`);
  }

  const knownBroken = new Set((reference?.brokenImages ?? []).map(shortURL));
  const broken = staging.brokenImages.filter((src) => !knownBroken.has(shortURL(src)));
  if (broken.length > 0) {
    add(
      newProblem,
      `Broken image${broken.length > 1 ? "s" : ""}: ${broken.slice(0, 3).map(shortURL).join(", ")}`,
    );
  }

  if (staging.horizontalOverflow && !reference?.horizontalOverflow) {
    const { documentWidth, viewportWidth } = staging.horizontalOverflow;
    add(
      newProblem,
      `Horizontal overflow: page is ${documentWidth}px wide at a ${viewportWidth}px viewport`,
    );
  }

  const knownErrors = new Set(reference?.consoleErrors ?? []);
  const errors = staging.consoleErrors.filter((message) => !knownErrors.has(message));
  if (errors.length > 0) {
    add(
      "info",
      `${errors.length} new console error${errors.length > 1 ? "s" : ""}: ${errors[0]!.slice(0, 120)}`,
    );
  }

  if (captures.staging?.unstable || captures.production?.unstable) {
    add("info", "The page kept changing between screenshots; mask or hide animated areas.");
  }

  if (options.checks) {
    findings.push(
      ...accessibilityFindings(staging, captures.production?.health, options.checks.accessibility),
      ...performanceFindings(staging, reference, options.checks.performance),
    );
  }
  for (const error of staging.checkErrors ?? []) add("info", `Check failed: ${error}`);
  return findings;
}

const IMPACT_RANK: Record<A11yImpact, number> = { minor: 0, moderate: 1, serious: 2, critical: 3 };

/**
 * New accessibility violations: rules that fail on more elements than on the reference. Without
 * reference results (no production capture, or a snapshot taken before the check was on), the
 * violations are listed as info, so turning the check on doesn't fail every page at once.
 *
 * Report relevant accessibility rules that affect more elements than in the reference capture.
 * Without reference evidence, list violations as information so enabling the check does not
 * invent a regression baseline.
 */
export function accessibilityFindings(
  current: HealthSignals,
  reference: HealthSignals | undefined,
  settings: ParsedConfig["checks"]["accessibility"],
): Finding[] {
  if (!settings.enabled || !current.accessibility) return [];
  const relevant = current.accessibility.filter(
    (violation) => IMPACT_RANK[violation.impact] >= IMPACT_RANK[settings.minImpact],
  );
  if (!reference?.accessibility) {
    if (relevant.length === 0) return [];
    const elements = relevant.reduce((sum, violation) => sum + violation.count, 0);
    return [
      {
        severity: "info",
        source: "health",
        message: `Accessibility: ${relevant.length} rule${relevant.length > 1 ? "s" : ""} failing on ${elements} element${elements > 1 ? "s" : ""} (${relevant.map((violation) => violation.id).join(", ")}); nothing to compare with yet`,
      },
    ];
  }
  const before = new Map(reference.accessibility.map((violation) => [violation.id, violation]));
  return relevant.flatMap((violation): Finding[] => {
    const previous = before.get(violation.id);
    const added = violation.count - (previous?.count ?? 0);
    if (added <= 0) return [];
    const known = new Set(previous?.targets ?? []);
    const targets = violation.targets.filter((target) => !known.has(target)).slice(0, 3);
    return [
      {
        severity: settings.severity,
        source: "health",
        message: `Accessibility (${violation.impact}): ${violation.help} — ${added} new element${added > 1 ? "s" : ""}${targets.length > 0 ? `: ${targets.join(", ")}` : ""} [${violation.id}]`,
      },
    ];
  });
}

/**
 * Format kilobytes as KB or MB depending on their size. Divide by 1024 only for the MB label.
 */
function formatKB(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}

/**
 * Convert milliseconds to a seconds label with one decimal place. This is presentation text for
 * performance findings.
 */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Load metrics that got worse than the reference by more than the configured margins.
 *
 * Compare current metrics with reference values using configured timing, layout-shift and
 * payload thresholds. Return no findings for disabled checks or unavailable evidence.
 */
export function performanceFindings(
  current: HealthSignals,
  reference: HealthSignals | undefined,
  settings: ParsedConfig["checks"]["performance"],
): Finding[] {
  const now = current.performance;
  const before = reference?.performance;
  if (!settings.enabled || !now || !before) return [];
  const findings: Finding[] = [];
  /**
   * Append one performance finding using the configured severity. This closure avoids repeating
   * the source/severity fields for every metric.
   */
  const add = (message: string) =>
    findings.push({ severity: settings.severity, source: "health", message });

  if (
    now.lcpMs !== undefined &&
    before.lcpMs !== undefined &&
    now.lcpMs - before.lcpMs > settings.lcpIncreaseMs
  ) {
    add(`Slower load: LCP ${seconds(before.lcpMs)} → ${seconds(now.lcpMs)}`);
  }
  if (now.cls - before.cls > settings.clsIncrease) {
    add(`More layout shift while loading: CLS ${before.cls} → ${now.cls}`);
  }
  /**
   * Require a payload increase to exceed both its absolute KB margin and percentage margin.
   * Using both guards avoids flagging tiny files solely because their relative increase is
   * large.
   */
  const grew = (after: number, earlier: number) =>
    after - earlier > settings.weightIncreaseKB &&
    after > earlier * (1 + settings.weightIncreasePercent / 100);
  if (grew(now.transferKB, before.transferKB)) {
    const percent = Math.round((now.transferKB / Math.max(1, before.transferKB) - 1) * 100);
    add(
      `Heavier page: ${formatKB(before.transferKB)} → ${formatKB(now.transferKB)} (+${percent}%)`,
    );
  }
  if (grew(now.jsKB, before.jsKB)) {
    add(`More JavaScript: ${formatKB(before.jsKB)} → ${formatKB(now.jsKB)}`);
  }
  return findings;
}
