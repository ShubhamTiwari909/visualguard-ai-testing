import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DomSnapshot } from "../capture/dom-snapshot.js";
import { errorMessage } from "../core/errors.js";
import type { Analysis, Finding, JobResult, RunManifest, Status } from "../core/types.js";
import { AnalysisCache, requestCacheKey } from "./cache.js";
import { AIError, jsonSchemaFor, type AIProvider } from "./provider.js";
import {
  analyzeVisualDiff,
  buildParts,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  VisualAnalysisSchema,
} from "./tasks/analyze-diff.js";

import { AIBudget, budgetedProvider } from "./budget.js";

export interface AnalysisSettings {
  maxGenerationAttempts?: number;
  maxNetworkAttempts?: number;
  maxTokens?: number;
  timeoutMs?: number;
  cacheTTLHours?: number;
  thinking?: string;
  imageDetail?: string;
  advisory?: boolean;
  intent?: { title: string; description?: string; changedFiles: string[] };
  maxRegionsPerJob: number;
  noiseConfidence: number;
  maxCallsPerRun: number;
}

/** Shared across a run: provider, cache, call budget and token usage. */
export class AnalysisSession {
  calls = 0;
  readonly budget: AIBudget;
  get usage() {
    return this.budget.usage;
  }
  private readonly cache: AnalysisCache | undefined;
  /** Set when the provider can't answer for the rest of the run (quota, bad key). */
  private stopped: string | undefined;

  constructor(
    readonly provider: AIProvider,
    readonly settings: AnalysisSettings,
    options: { cacheDir?: string; signal?: AbortSignal } = {},
  ) {
    this.budget = new AIBudget(settings, options.signal);
    this.cache = options.cacheDir
      ? new AnalysisCache(options.cacheDir, (settings.cacheTTLHours ?? 24) * 3_600_000)
      : undefined;
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
    const input = {
      job,
      runDir,
      mode,
      maxRegions: this.settings.maxRegionsPerJob,
      knownSelectors: knownSelectors(job, runDir),
      intent: this.settings.intent,
      signal: this.budget.signal,
    };
    let parts: ReturnType<typeof buildParts>;
    try {
      parts = buildParts(this.provider, input);
    } catch (error) {
      return addFinding(
        updated,
        base,
        `AI analysis failed: could not prepare images: ${errorMessage(error)}`,
      );
    }
    const key = requestCacheKey({
      provider: this.provider.name,
      model: this.provider.model,
      promptVersion: PROMPT_VERSION,
      system: SYSTEM_PROMPT,
      schema: jsonSchemaFor(VisualAnalysisSchema),
      settings: { thinking: this.settings.thinking, imageDetail: this.settings.imageDetail },
      parts,
      knownSelectors: [...input.knownSelectors].sort(),
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
        result = await analyzeVisualDiff(budgetedProvider(this.provider, this.budget), {
          ...input,
          parts,
        });
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
      intent: this.settings.intent,
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
  settings: Pick<AnalysisSettings, "noiseConfidence" | "advisory">,
): Status {
  if (base === "error" || base === "accepted") return base;
  const hardFailure =
    base === "regression" || findings.some((finding) => finding.severity === "regression");
  if (hardFailure) return "regression";
  if (settings.advisory) return base;
  const independentReview = findings.some((f) => f.source === "health" && f.severity === "review");
  switch (analysis.classification) {
    case "regression":
      return "regression";
    case "intentional":
    case "content":
      return "review";
    case "noise":
      return !independentReview && analysis.confidence >= settings.noiseConfidence
        ? "pass"
        : "review";
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
