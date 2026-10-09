/**
 * @file Re-analyzes saved run artifacts, restores accumulated usage and updates the
 * manifest/report.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { restoreRunUsage, persistRunUsage } from "../../ai/budget.js";
import { join } from "node:path";
import { Option, type Command } from "commander";
import pLimit from "p-limit";
import pc from "picocolors";
import { AnalysisSession, needsAnalysis } from "../../ai/analyze-job.js";
import { createProvider } from "../../ai/factory.js";
import type { AIProvider } from "../../ai/provider.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { matchesAny } from "../../config/glob.js";
import { EnvironmentError } from "../../core/errors.js";
import { findRun, readManifest, recordRun, writeManifest } from "../../core/runs.js";
import { exitCodeFor, FAIL_ON_VALUES, summarize } from "../../core/status.js";
import type { FailOn, JobResult, RunManifest } from "../../core/types.js";
import { pluralize } from "../../core/util.js";
import { writeReport } from "../../reporters/html.js";
import {
  STATUS_LABEL,
  STATUS_SYMBOL,
  statusColor,
  writeAnalysis,
} from "../../reporters/terminal.js";
import { collect, isCI, loadResolvedConfig, usePlainOutput } from "../shared.js";

export interface AnalyzeFlags {
  config?: string;
  run?: string;
  provider?: "gemini" | "ollama" | "none";
  model?: string;
  cache: boolean;
  only?: string[];
  failOn: FailOn;
  ci?: boolean;
  json?: boolean;
}

/**
 * Register the analyze command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze")
    .description("run AI analysis on an existing run without capturing again")
    .option("-c, --config <path>", "config file path")
    .option("--run <id>", "run id, id prefix or run number (default: latest)")
    .addOption(new Option("--provider <name>", "AI provider").choices(["gemini", "ollama"]))
    .option("--model <id>", "AI model id")
    .option("--no-cache", "ignore cached answers")
    .option("--only <glob>", "analyze only matching routes; repeatable", collect)
    .addOption(
      new Option("--fail-on <level>", "what makes the exit code non-zero")
        .choices(FAIL_ON_VALUES as string[])
        .default("regression"),
    )
    .option("--ci", "no colours")
    .option("--json", "print the updated manifest JSON to stdout")
    .action(async (flags: AnalyzeFlags) => {
      process.exitCode = await runAnalyzeCommand(flags);
    });
}

export interface ReanalyzeOptions {
  provider: AIProvider;
  runId?: string;
  useCache?: boolean;
  only?: string[];
  /**
   * Called as each job finishes.
   */
  onJob?: (job: JobResult) => void;
}

export interface ReanalyzeResult {
  manifest: RunManifest;
  runDir: string;
  analyzed: number;
  calls: number;
}

/**
 * Runs AI analysis on a finished run (PLAN.md §10, `visualguard analyze`): every job that
 * differs is analyzed from its base status, then the manifest, run index and report are
 * updated.
 *
 * Revisit saved screenshot evidence without opening a browser again. Restore the run's usage,
 * analyze eligible jobs from their base verdicts and rewrite the manifest, index and HTML
 * report.
 */
export async function reanalyzeRun(
  config: ResolvedConfig,
  options: ReanalyzeOptions,
): Promise<ReanalyzeResult> {
  const { dir } = findRun(config.outputDir, options.runId);
  const manifest = readManifest(dir);
  const session = new AnalysisSession(options.provider, config.ai, {
    cacheDir: options.useCache === false ? undefined : join(config.outputDir, "cache", "ai"),
  });
  restoreRunUsage(session.budget, dir, manifest.usage);
  const targets = manifest.jobs.filter(
    (job) => needsAnalysis(job) && (!options.only?.length || matchesAny(job.route, options.only)),
  );

  const limit = pLimit(config.ai.concurrency);
  const analyzed = new Map<string, JobResult>();
  await Promise.all(
    targets.map((job) =>
      limit(async () => {
        const result = await session.analyze(job, dir, manifest.mode);
        analyzed.set(job.id, result);
        options.onJob?.(result);
      }),
    ),
  );

  const jobs = manifest.jobs.map((job) => analyzed.get(job.id) ?? job);
  const previous = manifest.usage ?? { aiCalls: 0, inputTokens: 0, outputTokens: 0 };
  const updated: RunManifest = {
    ...manifest,
    jobs,
    summary: summarize(jobs),
    config: {
      ...manifest.config,
      ai: { provider: options.provider.name, model: options.provider.model },
    },
    usage: {
      aiCalls: previous.aiCalls + session.calls,
      generationAttempts: session.budget.generationAttempts,
      networkAttempts: session.budget.networkAttempts,
      inputTokens: session.usage.inputTokens,
      outputTokens: session.usage.outputTokens,
      thinkingTokens: session.usage.thinkingTokens || undefined,
    },
  };
  persistRunUsage(session.budget, dir);
  writeManifest(dir, updated);
  recordRun(config.outputDir, updated, config.output.keepRuns);
  if (config.report.html) writeReport(dir, updated);
  return { manifest: updated, runDir: dir, analyzed: targets.length, calls: session.calls };
}

/**
 * Resolve CLI configuration, select the saved run and run analysis. Return the resulting exit
 * code so the caller can set process.exitCode without abruptly terminating pending output.
 */
export async function runAnalyzeCommand(flags: AnalyzeFlags): Promise<number> {
  const config = await loadResolvedConfig({
    config: flags.config,
    provider: flags.provider,
    model: flags.model,
  });
  const created = createProvider(config.ai);
  if (!created.provider) {
    throw new EnvironmentError(created.reason ?? "No AI provider is configured", {
      hint: "Set ai.provider in visualguard.config.ts or pass --provider gemini|ollama (Gemini needs GEMINI_API_KEY).",
    });
  }
  const provider = created.provider;
  const { dir } = findRun(config.outputDir, flags.run);
  const before = readManifest(dir);

  const out = flags.json ? process.stderr : process.stdout;
  const colors = pc.createColors(
    !usePlainOutput(flags.ci, out as NodeJS.WriteStream) && pc.isColorSupported && !isCI(),
  );
  /**
   * Write progress to the selected output stream. With JSON output, progress belongs on stderr
   * so stdout remains machine-readable.
   */
  const write = (line = "") => out.write(`${line}\n`);
  const count = before.jobs.filter(
    (job) => needsAnalysis(job) && (!flags.only?.length || matchesAny(job.route, flags.only)),
  ).length;
  write();
  write(
    `  Analyzing ${pluralize(count, "changed page")} from run #${before.number} with ${provider.name} (${provider.model})`,
  );
  write();

  const { manifest, calls, analyzed } = await reanalyzeRun(config, {
    provider,
    runId: flags.run,
    useCache: flags.cache,
    only: flags.only,
    /**
     * Print each reanalyzed job as its result arrives. This callback presents the result; the
     * analysis session determines its status.
     */
    onJob: (job) => {
      const color = statusColor(colors, job.status);
      const detail = job.analysis
        ? `${job.analysis.classification} · ${job.analysis.title}`
        : (job.findings?.at(-1)?.message ?? "");
      write(
        `  ${color(STATUS_SYMBOL[job.status])}  ${job.route}  ${colors.dim(job.viewport)}  ${color(STATUS_LABEL[job.status])}  ${colors.dim(detail)}`,
      );
    },
  });

  for (const job of manifest.jobs
    .filter((item) => item.status === "regression" && item.analysis)
    .slice(0, 5)) {
    writeAnalysis(write, colors, job);
  }
  const { summary } = manifest;
  write();
  write(
    `  ${summary.pass} passed · ${summary.review} review · ${pluralize(summary.regression, "regression")} · ${pluralize(summary.error, "error")} · ${pluralize(calls, "AI call")} (${analyzed - calls} cached or skipped)`,
  );
  write();
  if (flags.json) process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return exitCodeFor(manifest, flags.failOn);
}
