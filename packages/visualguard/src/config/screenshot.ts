import type { ResolvedConfig } from "./resolve.js";
import type { JobSpec } from "../core/types.js";

/** Resolve a route/check override without treating explicit page capture as inheritance. */
export function screenshotSelector(
  config: Pick<ResolvedConfig, "screenshot">,
  job: Pick<JobSpec, "screenshotSelector">,
): string | undefined {
  return job.screenshotSelector === null
    ? undefined
    : (job.screenshotSelector ?? config.screenshot.selector);
}
