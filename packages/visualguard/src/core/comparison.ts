/**
 * @file Shared CLI/fixture classification: loads DOM evidence and combines visual
 * classification with independent check findings.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DomSnapshot } from "../capture/dom-snapshot.js";
import type { ParsedConfig } from "../config/schema.js";
import { classifyJob } from "../mapping/classify.js";
import { applyFindings, healthFindings } from "./findings.js";
import type { JobResult } from "./types.js";

/**
 * Shared CLI/fixture classification and independent-check policy.
 *
 * Combine image/DOM classification with independent health, accessibility and performance
 * checks. Store the deterministic verdict as baseStatus so later AI analysis can preserve hard
 * evidence.
 */
export function classifyComparison(
  job: JobResult,
  runDir: string,
  checks: ParsedConfig["checks"],
  baselineHealth = false,
): JobResult {
  /**
   * Load a saved DOM snapshot for one environment when it exists and parses. Return undefined
   * if unavailable so image classification can continue with less evidence.
   */
  const dom = (side: "production" | "staging"): DomSnapshot | undefined => {
    const path = job.captures[side]?.dom;
    if (!path || !existsSync(join(runDir, path))) return undefined;
    try {
      return JSON.parse(readFileSync(join(runDir, path), "utf8"));
    } catch {
      return undefined;
    }
  };
  const findings = [
    ...(job.findings ?? []),
    ...healthFindings(job.captures, { checks, baselineHealth }),
  ];
  let visual: "pass" | "review" | "regression" = "pass";
  if (job.diff && job.diff.diffPixels > 0 && job.regions.length) {
    const classified = classifyJob({
      diff: job.diff,
      regions: job.regions,
      production: dom("production"),
      staging: dom("staging"),
    });
    job = { ...job, regions: classified.regions };
    findings.unshift(...classified.findings);
    visual = classified.status;
  }
  const status = applyFindings(visual, findings);
  return { ...job, status, baseStatus: status, findings: findings.length ? findings : undefined };
}
