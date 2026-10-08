import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AIProvider } from "../ai/provider.js";
import { generatePatch } from "../ai/tasks/generate-patch.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { matchesAny } from "../config/glob.js";
import { ConfigError, errorMessage } from "../core/errors.js";
import { findRun, readManifest } from "../core/runs.js";
import type { JobResult } from "../core/types.js";
import { applyEdits, renderDiff, revertEdits, validateEdits, type Edit } from "./edits.js";
import { listSourceFiles } from "./files.js";
import { changedSince, dirtyFiles, gitRoot } from "./git.js";
import { heuristicEdits } from "./heuristic-edits.js";
import { collectClues, excerpt, locateSource, type Candidate } from "./locate.js";
import { DevServer, runCommands, verifyAgainstProduction } from "./verify.js";

export interface Proposal {
  job: JobResult;
  edits: Edit[];
  diff: string;
  source: "heuristic" | "ai";
  summary: string;
  attempt: number;
  candidates: Candidate[];
}

export type FixResult = "fixed" | "unverified" | "rejected" | "failed" | "skipped";

export interface FixOutcome {
  job: JobResult;
  result: FixResult;
  message: string;
  edits: Edit[];
  attempts: number;
  /** Diff of the applied change (fixed or unverified). */
  diff?: string;
}

export interface FixCallbacks {
  /** Return false to skip this proposal. Not called when confirmation is off. */
  confirm(proposal: Proposal): Promise<boolean>;
  /** Asked once before source excerpts are first sent to an AI provider. */
  consent(files: string[], provider: AIProvider): Promise<boolean>;
  progress(job: JobResult, message: string): void;
}

export interface FixOptions {
  runId?: string;
  routes?: string[];
  viewports?: string[];
  /** Also try jobs marked review (default: regressions only). */
  includeReview?: boolean;
  allowDirty?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  provider?: AIProvider;
  callbacks: FixCallbacks;
  /** Project directory to edit; defaults to config.cwd (a worktree in --auto mode). */
  workdir?: string;
}

const consentPath = (config: ResolvedConfig) => join(config.outputDir, "consent.json");

function hasConsent(config: ResolvedConfig, provider: AIProvider): boolean {
  if (config.fix.allowSourceUpload) return true;
  if (!existsSync(consentPath(config))) return false;
  try {
    const consent = JSON.parse(readFileSync(consentPath(config), "utf8")) as {
      providers?: string[];
    };
    return Boolean(consent.providers?.includes(provider.name));
  } catch {
    return false;
  }
}

function recordConsent(config: ResolvedConfig, provider: AIProvider): void {
  const path = consentPath(config);
  const providers = new Set<string>([provider.name]);
  if (existsSync(path)) {
    try {
      for (const name of (JSON.parse(readFileSync(path, "utf8")) as { providers?: string[] })
        .providers ?? [])
        providers.add(name);
    } catch {
      // Rewrite a broken file.
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ providers: [...providers], grantedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/** Jobs from a run that `fix` should work on. */
export function selectFixableJobs(
  jobs: JobResult[],
  options: Pick<FixOptions, "routes" | "viewports" | "includeReview">,
): JobResult[] {
  return jobs.filter(
    (job) =>
      (job.status === "regression" || (options.includeReview && job.status === "review")) &&
      job.captures.production &&
      job.captures.staging &&
      (!options.routes?.length || matchesAny(job.route, options.routes)) &&
      (!options.viewports?.length || options.viewports.includes(job.viewport)),
  );
}

/**
 * The fix loop (PLAN.md §13.2): locate source → propose edits (deterministic first, then AI) →
 * validate → confirm → apply → run commands → re-capture on the local server and compare with
 * production → keep, or revert and retry with feedback.
 */
export async function fixRegressions(
  config: ResolvedConfig,
  options: FixOptions,
): Promise<FixOutcome[]> {
  if (!config.fix.enabled) {
    throw new ConfigError("Fixing is turned off.", {
      hint: "Set fix: { enabled: true } in visualguard.config.ts. Fixes are applied only after you confirm them.",
    });
  }
  const workdir = options.workdir ?? config.cwd;
  if (!gitRoot(workdir)) {
    throw new ConfigError(
      "`visualguard fix` needs a git repository, so every change can be reviewed and undone.",
    );
  }
  const dirty = dirtyFiles(workdir);
  if (dirty.length > 0 && !options.allowDirty) {
    throw new ConfigError(
      `The working tree has uncommitted changes (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? ", …" : ""}).`,
      {
        hint: "Commit or stash them first, or pass --allow-dirty.",
      },
    );
  }

  const { dir: runDir } = findRun(config.outputDir, options.runId);
  const manifest = readManifest(runDir);
  const jobs = selectFixableJobs(manifest.jobs, options);
  if (jobs.length === 0) return [];

  const changed = config.fix.compareRef
    ? new Set(changedSince(workdir, config.fix.compareRef))
    : undefined;
  const server = config.fix.verify.server
    ? new DevServer(config.fix.verify.server, workdir)
    : undefined;
  const outcomes: FixOutcome[] = [];

  try {
    for (const job of jobs) {
      outcomes.push(await fixJob(config, job, { ...options, workdir, runDir, changed, server }));
    }
  } finally {
    await server?.stop();
  }
  return outcomes;
}

async function fixJob(
  config: ResolvedConfig,
  job: JobResult,
  context: FixOptions & {
    workdir: string;
    runDir: string;
    changed?: Set<string>;
    server?: DevServer;
  },
): Promise<FixOutcome> {
  const { callbacks, workdir } = context;
  const files = listSourceFiles(workdir, config.fix.include);
  const clues = collectClues(job, context.runDir);
  const candidates = locateSource({ job, clues, files, cwd: workdir, changed: context.changed });
  if (candidates.length === 0) {
    return {
      job,
      result: "skipped",
      message: "No source files matched this change (check fix.include).",
      edits: [],
      attempts: 0,
    };
  }
  callbacks.progress(
    job,
    `Likely source: ${candidates
      .slice(0, 3)
      .map((candidate) => candidate.path)
      .join(", ")}`,
  );

  const candidateFiles = files.filter((file) =>
    candidates.some((candidate) => candidate.path === file.path),
  );
  let feedback: string | undefined;
  let previous: Edit[] | undefined;
  let triedHeuristic = false;

  for (let attempt = 1; attempt <= config.fix.maxAttempts; attempt++) {
    let edits: Edit[] = [];
    let source: Proposal["source"] = "heuristic";
    let summary = "";

    if (!triedHeuristic) {
      triedHeuristic = true;
      edits = heuristicEdits(clues, candidateFiles);
      summary = edits.map((edit) => edit.reason).join("; ");
      if (edits.length > 0 && validateEdits(workdir, edits, config.fix.include).length > 0)
        edits = [];
    }
    if (edits.length === 0) {
      if (!context.provider) {
        return {
          job,
          result: "skipped",
          message: "No deterministic fix found, and no AI provider is configured to propose one.",
          edits: [],
          attempts: attempt - 1,
        };
      }
      if (!hasConsent(config, context.provider)) {
        const ok = await callbacks.consent(
          candidates.map((candidate) => candidate.path),
          context.provider,
        );
        if (!ok)
          return {
            job,
            result: "skipped",
            message: "Not sending source code to the AI provider.",
            edits: [],
            attempts: attempt - 1,
          };
        recordConsent(config, context.provider);
      }
      source = "ai";
      try {
        callbacks.progress(
          job,
          `Asking ${context.provider.name} for a patch${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
        );
        const patch = await generatePatch(context.provider, {
          job,
          runDir: context.runDir,
          files: candidates.map((candidate) => ({
            path: candidate.path,
            reasons: candidate.reasons,
            excerpt: excerpt(
              files.find((file) => file.path === candidate.path)!.content,
              candidate.lines,
            ),
          })),
          feedback,
          previous,
        });
        edits = patch.edits;
        summary = patch.summary;
      } catch (error) {
        return {
          job,
          result: "failed",
          message: `AI patch failed: ${errorMessage(error)}`,
          edits: [],
          attempts: attempt,
        };
      }
      const problems = validateEdits(workdir, edits, config.fix.include);
      if (problems.length > 0) {
        feedback = problems.join(" ");
        previous = edits;
        callbacks.progress(job, `Proposed edits were invalid: ${feedback}`);
        continue;
      }
    }

    const proposal: Proposal = {
      job,
      edits,
      diff: renderDiff(workdir, edits),
      source,
      summary,
      attempt,
      candidates,
    };
    if (config.fix.requireConfirmation && !context.yes && !(await callbacks.confirm(proposal))) {
      return { job, result: "rejected", message: "Change not applied.", edits, attempts: attempt };
    }

    const originals = applyEdits(workdir, edits);
    callbacks.progress(job, `Applied ${edits.length} edit${edits.length === 1 ? "" : "s"}`);

    const commands = await runCommands(
      config.fix.verify.commands,
      workdir,
      config.fix.verify.commandTimeoutMs,
    );
    const failedCommand = commands.find((result) => !result.ok);
    for (const result of commands)
      callbacks.progress(job, `${result.ok ? "✓" : "✖"} ${result.command}`);
    if (failedCommand) {
      revertEdits(workdir, originals);
      feedback = `\`${failedCommand.command}\` failed after the edit:\n${failedCommand.output}`;
      previous = edits;
      continue;
    }

    if (!context.server) {
      return {
        job,
        result: "unverified",
        message: "Applied but not verified: set fix.verify.server to check it visually.",
        edits,
        attempts: attempt,
        diff: proposal.diff,
      };
    }

    try {
      await context.server.ensure();
      callbacks.progress(job, `Re-capturing ${job.route} on ${context.server.url}`);
      const verification = await verifyAgainstProduction(config, job, context.server.url);
      if (verification.resolved) {
        const pixels = verification.job.diff?.diffPixels ?? 0;
        return {
          job,
          result: "fixed",
          message: `${job.route} now matches production (${pixels} differing pixel${pixels === 1 ? "" : "s"})`,
          edits,
          attempts: attempt,
          diff: proposal.diff,
        };
      }
      revertEdits(workdir, originals);
      const still = verification.job.findings?.find((item) => item.severity !== "info")?.message;
      feedback = `After the edit the page still differs from production (${((verification.job.diff?.diffRatio ?? 0) * 100).toFixed(2)}% of pixels${still ? `; ${still}` : ""}).`;
      previous = edits;
      callbacks.progress(job, `Still differs; reverted. ${feedback}`);
    } catch (error) {
      revertEdits(workdir, originals);
      return {
        job,
        result: "failed",
        message: `Verification failed: ${errorMessage(error)}`,
        edits,
        attempts: attempt,
      };
    }
  }
  return {
    job,
    result: "failed",
    message: `No working fix after ${config.fix.maxAttempts} attempt(s)${feedback ? `: ${feedback}` : ""}. All edits were reverted.`,
    edits: previous ?? [],
    attempts: config.fix.maxAttempts,
  };
}
