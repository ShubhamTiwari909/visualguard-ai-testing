/**
 * @file Applies time-limited `quarantine` entries to flaky checks and explains expired or
 * unmatched entries.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { QuarantineEntry } from "../config/schema.js";
import type { JobResult } from "./types.js";

/**
 * True until the end of the entry's expiry day, UTC. An entry written for "2026-12-31" still
 * applies to a run on that date anywhere in the world.
 */
export function isQuarantineActive(entry: QuarantineEntry, now: Date): boolean {
  return now.getTime() < Date.parse(`${entry.expires}T00:00:00Z`) + 24 * 60 * 60 * 1000;
}

/**
 * Mark a check covered by an active entry. Only a visual difference can be quarantined: the
 * status stays as found, errors still fail, and a non-info health finding (broken image,
 * failed request, accessibility or performance check) keeps the check failing.
 */
export function applyQuarantine(
  job: JobResult,
  entries: readonly QuarantineEntry[],
  now: Date,
): JobResult {
  if (job.status !== "review" && job.status !== "regression") return job;
  if (job.findings?.some((finding) => finding.source === "health" && finding.severity !== "info"))
    return job;
  const entry = entries.find(
    (candidate) =>
      candidate.route === job.route &&
      (candidate.viewport === undefined || candidate.viewport === job.viewport) &&
      isQuarantineActive(candidate, now),
  );
  if (!entry) return job;
  return {
    ...job,
    quarantined: { owner: entry.owner, reason: entry.reason, expires: entry.expires },
  };
}

/**
 * Run warnings for entries that no longer apply: expired ones, so their owner gets nudged, and
 * ones whose route or viewport is not part of this run, which usually means a typo.
 */
export function quarantineWarnings(
  entries: readonly QuarantineEntry[],
  jobs: ReadonlyArray<Pick<JobResult, "route" | "viewport">>,
  now: Date,
): string[] {
  const warnings: string[] = [];
  for (const entry of entries) {
    const label = `${entry.route}${entry.viewport ? ` (${entry.viewport})` : ""}`;
    if (!isQuarantineActive(entry, now)) {
      warnings.push(
        `Quarantine for ${label} expired on ${entry.expires}; it counts again. Owner: ${entry.owner}.`,
      );
    } else if (
      !jobs.some(
        (job) =>
          job.route === entry.route &&
          (entry.viewport === undefined || entry.viewport === job.viewport),
      )
    ) {
      warnings.push(`Quarantine for ${label} matches no check in this run.`);
    }
  }
  return warnings;
}
