import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DomSnapshot } from "../capture/dom-snapshot.js";
import { errorMessage } from "../core/errors.js";
import type { Analysis, Finding, JobResult, RunManifest, Status } from "../core/types.js";
import { AnalysisCache, cacheKey } from "./cache.js";
import { AIError, addUsage, type AIProvider, type Usage } from "./provider.js";
import { analyzeVisualDiff, PROMPT_VERSION } from "./tasks/analyze-diff.js";

export interface AnalysisSettings {
  maxRegionsPerJob: number;
  noiseConfidence: number;
  maxCallsPerRun: number;
}

/** Shared across a run: provider, cache, call budget and token usage. */
export class AnalysisSession {
  calls = 0;
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  private readonly cache: AnalysisCache | undefined;
  /** Set when the provider can't answer for the rest of the run (quota, bad key). */
  private stopped: string | undefined;

  constructor(
    readonly provider: AIProvider,
    readonly settings: AnalysisSettings,
    options: { cacheDir?: string } = {},
  ) {
    this.cache = options.cacheDir ? new AnalysisCache(options.cacheDir) : undefined;
  }

  get budgetLeft(): number {
    return this.settings.maxCallsPerRun - this.calls;
  }

  async analyze(job: JobResult, runDir: string, mode: RunManifest["mode"]): Promise<JobResult> {
    const base = job.baseStatus ?? job.status;
    const updated: JobResult = {
      ...job,
      baseStatus: base,
      findings: withoutAIFindings(job.findings),
    };
    const key = cacheKey(job, runDir, {
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: PROMPT_VERSION,
      maxRegions: this.settings.maxRegionsPerJob,
    });

    let result = this.cache?.get(key);
    const cached = Boolean(result);
    if (!result) {
      if (this.stopped) return addFinding(updated, base, `AI skipped: ${this.stopped}`);
      if (this.budgetLeft <= 0) {
        return addFinding(
          updated,
          base,
          "AI budget reached (ai.maxCallsPerRun); explained by heuristics only",
        );
      }
      this.calls++;
      try {
        result = await analyzeVisualDiff(this.provider, {
          job,
          runDir,
          mode,
          maxRegions: this.settings.maxRegionsPerJob,
          knownSelectors: knownSelectors(job, runDir),
        });
        addUsage(this.usage, result.usage);
        this.cache?.set(key, result);
      } catch (error) {
        if (error instanceof AIError && error.stopsRun) this.stopped = error.message;
        // AI failures never fail the run: the heuristic status stands.
        return addFinding(updated, base, `AI analysis failed: ${errorMessage(error)}`);
      }
    }

    const analysis: Analysis = {
      ...result.analysis,
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: PROMPT_VERSION,
      cached,
    };
    return {
      ...updated,
      analysis,
      status: statusWithAnalysis(base, updated.findings ?? [], analysis, this.settings),
    };
  }
}

/**
 * Jobs that differ and have something to show the model. With `scope: "uncertain"`, jobs the
 * heuristics already marked as regressions are skipped: the model can't change that status.
 */
export function needsAnalysis(job: JobResult, scope: "uncertain" | "all" = "all"): boolean {
  if (scope === "uncertain" && (job.baseStatus ?? job.status) === "regression") return false;
  return (
    !job.error &&
    (job.baseStatus ?? job.status) !== "pass" &&
    job.status !== "accepted" &&
    Boolean(job.diff && job.diff.diffPixels > 0) &&
    job.regions.some((region) => region.crops)
  );
}

/**
 * Combines the heuristic status with the model's classification (PLAN.md §10.5). Hard failures
 * found without AI (findings with severity "regression") are never downgraded (principle 8).
 */
export function statusWithAnalysis(
  base: Status,
  findings: readonly Finding[],
  analysis: Pick<Analysis, "classification" | "confidence">,
  settings: Pick<AnalysisSettings, "noiseConfidence">,
): Status {
  if (base === "error" || base === "accepted") return base;
  const hardFailure =
    base === "regression" || findings.some((finding) => finding.severity === "regression");
  if (hardFailure) return "regression";
  switch (analysis.classification) {
    case "regression":
      return "regression";
    case "intentional":
    case "content":
      return "review";
    case "noise":
      return analysis.confidence >= settings.noiseConfidence ? "pass" : "review";
  }
}

const AI_FINDING = /^AI (analysis failed|budget reached|skipped)/;

function withoutAIFindings(findings: Finding[] | undefined): Finding[] | undefined {
  const kept = findings?.filter((finding) => !AI_FINDING.test(finding.message));
  return kept && kept.length > 0 ? kept : undefined;
}

function addFinding(job: JobResult, status: Status, message: string): JobResult {
  return {
    ...job,
    status,
    analysis: undefined,
    findings: [...(job.findings ?? []), { severity: "info", message, source: "heuristic" }],
  };
}

function knownSelectors(job: JobResult, runDir: string): Set<string> {
  const selectors = new Set<string>();
  for (const region of job.regions) {
    for (const element of region.elements) selectors.add(element.selector);
    for (const delta of region.deltas) selectors.add(delta.selector);
  }
  for (const env of ["production", "staging"] as const) {
    const dom = job.captures[env]?.dom;
    if (!dom || !existsSync(join(runDir, dom))) continue;
    try {
      const snapshot = JSON.parse(readFileSync(join(runDir, dom), "utf8")) as DomSnapshot;
      for (const node of snapshot.nodes) selectors.add(node.sel);
    } catch {
      // A broken snapshot only weakens the guardrail.
    }
  }
  return selectors;
}
