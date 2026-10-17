import type { RunDetail } from "../../shared/contracts.js";
import { reviewRun } from "./review-run.js";

export function baselineRun(id?: string): RunDetail {
  const run = reviewRun(id);
  run.metadata.commit = "a".repeat(40);
  for (const job of run.manifest.jobs) {
    job.renderingIdentity = {
      platform: process.platform,
      policy: {
        browser: { name: "chromium", colorScheme: "light", locale: "en-US" },
        viewport: { width: 100, height: 100 },
      },
    } as NonNullable<typeof job.renderingIdentity>;
    job.findings = [];
    for (const capture of Object.values(job.captures))
      if (capture) capture.health.failedRequests = [];
  }
  run.artifacts = [
    { path: "candidate.png", hash: "1".repeat(64), size: 10, mediaType: "image/png" },
    { path: "reference.png", hash: "0".repeat(64), size: 10, mediaType: "image/png" },
  ];
  return run;
}
