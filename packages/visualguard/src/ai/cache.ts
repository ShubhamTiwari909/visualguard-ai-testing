import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobResult } from "../core/types.js";
import type { AnalyzeOutput } from "./tasks/analyze-diff.js";
import { regionsForAnalysis } from "./tasks/analyze-diff.js";

/**
 * Answers are cached by everything the model sees (PLAN.md §10.7): crops, deltas, findings,
 * prompt version, provider and model. Re-running on unchanged differences costs nothing.
 */
export function cacheKey(
  job: JobResult,
  runDir: string,
  parts: { provider: string; model: string; promptVersion: string; maxRegions: number },
): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([parts.provider, parts.model, parts.promptVersion, job.route, job.viewport]),
  );
  hash.update(JSON.stringify(job.findings ?? []));
  for (const region of regionsForAnalysis(job, parts.maxRegions)) {
    hash.update(JSON.stringify([region.kind, region.box, region.deltas, region.elements]));
    for (const side of ["production", "staging"] as const) {
      const path = region.crops?.[side];
      if (path) hash.update(readFileSync(join(runDir, path)));
    }
  }
  return hash.digest("hex");
}

export class AnalysisCache {
  constructor(private readonly dir: string) {}

  get(key: string): AnalyzeOutput | undefined {
    const path = join(this.dir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as AnalyzeOutput;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: AnalyzeOutput): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value));
  }
}
