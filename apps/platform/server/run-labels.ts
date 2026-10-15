import type { RunDetail } from "../shared/contracts.js";
import { PlatformError } from "./errors.js";

export function normalizeRunName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length > 120)
    throw new PlatformError(400, "Run name must contain at most 120 characters");
  return value.trim() || undefined;
}

export function runSearchText(run: Omit<RunDetail, "id">) {
  return [run.name, run.engineRunId, run.metadata.branch, run.metadata.commit, run.metadata.deployment,
    ...run.manifest.jobs.flatMap((job) => [job.route, job.name, job.viewport])]
    .filter(Boolean).join(" ").toLowerCase();
}
