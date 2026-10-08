import type { CaptureResult, Env, Finding, FindingSeverity, Status } from "./types.js";

const RANK: Record<Status, number> = { pass: 0, accepted: 0, review: 1, regression: 2, error: 3 };

/** Raises `status` to the most severe finding: findings can only make a status worse. */
export function applyFindings(status: Status, findings: readonly Finding[]): Status {
  let result = status;
  for (const finding of findings) {
    if (finding.severity === "info") continue;
    if (RANK[finding.severity] > RANK[result]) result = finding.severity;
  }
  return result;
}

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
 * against, only problems that are new on staging count; without one (scan mode), any problem
 * is worth a review.
 */
export function healthFindings(captures: Partial<Record<Env, CaptureResult>>): Finding[] {
  const staging = captures.staging?.health;
  if (!staging) return [];
  const reference = captures.production?.source === "live" ? captures.production.health : undefined;
  const findings: Finding[] = [];
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
  return findings;
}
