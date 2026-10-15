import type { RunDetail } from "../shared/contracts.js";

export function runSearchText(run: Omit<RunDetail, "id">) {
  return [run.name, run.engineRunId, run.metadata.branch, run.metadata.commit, run.metadata.deployment,
    ...run.manifest.jobs.flatMap((job) => [job.route, job.name, job.viewport])]
    .filter(Boolean).join(" ").toLowerCase();
}
