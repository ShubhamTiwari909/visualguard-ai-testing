import { ExitCode } from "./errors.js";
import { STATUSES, type FailOn, type JobResult, type RunManifest, type Status } from "./types.js";

export function summarize(jobs: readonly Pick<JobResult, "status">[]): Record<Status, number> {
  const summary = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
    Status,
    number
  >;
  for (const job of jobs) summary[job.status]++;
  return summary;
}

/** Statuses that fail the run for each `--fail-on` level. Errors always fail. */
const FAILING: Record<FailOn, readonly Status[]> = {
  regression: ["regression", "error"],
  review: ["review", "regression", "error"],
  any: ["review", "regression", "error"],
};

export function isFailing(status: Status, failOn: FailOn): boolean {
  return FAILING[failOn].includes(status);
}

export function exitCodeFor(manifest: Pick<RunManifest, "summary">, failOn: FailOn): ExitCode {
  return FAILING[failOn].some((status) => manifest.summary[status] > 0)
    ? ExitCode.Failed
    : ExitCode.Ok;
}

export const FAIL_ON_VALUES: readonly FailOn[] = ["regression", "review", "any"];
