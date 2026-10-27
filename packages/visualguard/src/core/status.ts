/**
 * @file Counts statuses and translates failure policy/incomplete results to failing process
 * exit codes.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { ExitCode } from "./errors.js";
import { STATUSES, type FailOn, type JobResult, type RunManifest, type Status } from "./types.js";

/**
 * Initialize a zero count for every status, then count each job by its current verdict.
 * Including zero-valued statuses gives reporters a consistent summary shape.
 */
export function summarize(jobs: readonly Pick<JobResult, "status">[]): Record<Status, number> {
  const summary = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
    Status,
    number
  >;
  for (const job of jobs) summary[job.status]++;
  return summary;
}

/**
 * Statuses that fail the run for each `--fail-on` level. Errors always fail.
 */
const FAILING: Record<FailOn, readonly Status[]> = {
  regression: ["regression", "error"],
  review: ["review", "regression", "error"],
  any: ["review", "regression", "error"],
};

/**
 * Check whether a job status belongs to the selected failure policy. The policy determines
 * whether review jobs fail CI as well as regressions/errors.
 */
export function isFailing(status: Status, failOn: FailOn): boolean {
  return FAILING[failOn].includes(status);
}

/**
 * Return the failure code for an incomplete manifest or any status selected by failOn. A zero
 * exit code is returned only when the recorded evidence meets that policy.
 */
export function exitCodeFor(
  manifest: Pick<RunManifest, "summary" | "incomplete"> & {
    jobs?: ReadonlyArray<Pick<JobResult, "status" | "quarantined">>;
  },
  failOn: FailOn,
): ExitCode {
  if (manifest.incomplete) return ExitCode.Failed;
  // Prefer the jobs, so quarantined checks are skipped; a bare summary cannot tell.
  const failing = manifest.jobs
    ? manifest.jobs.some((job) => blocksRun(job, failOn))
    : FAILING[failOn].some((status) => manifest.summary[status] > 0);
  return failing ? ExitCode.Failed : ExitCode.Ok;
}

/**
 * Whether one check fails the run: its status fails under `failOn` and no active quarantine
 * entry covers it.
 */
export function blocksRun(job: Pick<JobResult, "status" | "quarantined">, failOn: FailOn): boolean {
  return isFailing(job.status, failOn) && !job.quarantined;
}

export const FAIL_ON_VALUES: readonly FailOn[] = ["regression", "review", "any"];
