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
import { listSourceFiles, type SourceFile } from "./files.js";
import { changedSince, dirtyFiles, gitRoot } from "./git.js";
import { heuristicEdits } from "./heuristic-edits.js";
import { collectClues, excerpt, locateSource, type Candidate, type Clues } from "./locate.js";
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
  /** In a worktree, the dev server must be started here, not reused from the main checkout. */
  freshServer?: boolean;
}

const consentPath = (config: ResolvedConfig) => join(config.outputDir, "consent.json");

export function hasConsent(config: ResolvedConfig, provider: AIProvider): boolean {
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

export function recordConsent(config: ResolvedConfig, provider: AIProvider): void {
  const path = consentPath(config);
  const providers = new Set<string>([provider.name]);
  if (existsSync(path)) {
    try {
      for (const name of (JSON.parse(readFileSync(path, "utf8")) as { providers?: string[] })
        .providers ?? []) {
        providers.add(name);
      }
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

export function assertCanFix(config: ResolvedConfig, workdir: string, allowDirty = false): void {
  if (!config.fix.enabled) {
    throw new ConfigError("Fixing is turned off.", {
      hint: "Set fix: { enabled: true } in visualguard.config.ts. Fixes are applied only after you confirm them.",
    });
  }
  if (!gitRoot(workdir)) {
    throw new ConfigError(
      "`visualguard fix` needs a git repository, so every change can be reviewed and undone.",
    );
  }
  const dirty = dirtyFiles(workdir);
  if (dirty.length > 0 && !allowDirty) {
    throw new ConfigError(
      `The working tree has uncommitted changes (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? ", …" : ""}).`,
      { hint: "Commit or stash them first, or pass --allow-dirty." },
    );
  }
}

/** Everything the fixer knows about one job's source. */
export interface FixWorkspace {
  job: JobResult;
  workdir: string;
  runDir: string;
  files: SourceFile[];
  clues: Clues;
  candidates: Candidate[];
}

export function prepareWorkspace(
  config: ResolvedConfig,
  job: JobResult,
  options: { workdir: string; runDir: string; changed?: Set<string> },
): FixWorkspace {
  const files = listSourceFiles(options.workdir, config.fix.include);
  const clues = collectClues(job, options.runDir);
  const candidates = locateSource({
    job,
    clues,
    files,
    cwd: options.workdir,
    changed: options.changed,
  });
  return { job, workdir: options.workdir, runDir: options.runDir, files, clues, candidates };
}

export type ProposeResult =
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "invalid"; edits: Edit[]; problems: string[] }
  | { kind: "stop"; result: FixResult; message: string };

/**
 * One proposal: the deterministic patch when allowed and possible, otherwise the AI's. Edits are
 * validated against the files before they are returned.
 */
export async function proposeEdits(
  config: ResolvedConfig,
  workspace: FixWorkspace,
  options: {
    attempt: number;
    useHeuristic: boolean;
    provider?: AIProvider;
    consent: (files: string[], provider: AIProvider) => Promise<boolean>;
    progress?: (message: string) => void;
    feedback?: string;
    previous?: Edit[];
  },
): Promise<ProposeResult> {
  const { job, workdir, candidates } = workspace;
  const make = (edits: Edit[], source: Proposal["source"], summary: string): ProposeResult => ({
    kind: "proposal",
    proposal: {
      job,
      edits,
      diff: renderDiff(workdir, edits),
      source,
      summary,
      attempt: options.attempt,
      candidates,
    },
  });

  if (options.useHeuristic) {
    const candidateFiles = workspace.files.filter((file) =>
      candidates.some((candidate) => candidate.path === file.path),
    );
    const edits = heuristicEdits(workspace.clues, candidateFiles);
    if (edits.length > 0 && validateEdits(workdir, edits, config.fix.include).length === 0) {
      return make(edits, "heuristic", edits.map((edit) => edit.reason).join("; "));
    }
  }

  const provider = options.provider;
  if (!provider) {
    return {
      kind: "stop",
      result: "skipped",
      message: "No deterministic fix found, and no AI provider is configured to propose one.",
    };
  }
  if (!hasConsent(config, provider)) {
    const ok = await options.consent(
      candidates.map((candidate) => candidate.path),
      provider,
    );
    if (!ok)
      return {
        kind: "stop",
        result: "skipped",
        message: "Not sending source code to the AI provider.",
      };
    recordConsent(config, provider);
  }
  try {
    options.progress?.(
      `Asking ${provider.name} for a patch${options.attempt > 1 ? ` (attempt ${options.attempt})` : ""}`,
    );
    const patch = await generatePatch(provider, {
      job,
      runDir: workspace.runDir,
      files: candidates.map((candidate) => ({
        path: candidate.path,
        reasons: candidate.reasons,
        excerpt: excerpt(
          workspace.files.find((file) => file.path === candidate.path)!.content,
          candidate.lines,
        ),
      })),
      feedback: options.feedback,
      previous: options.previous,
    });
    const problems = validateEdits(workdir, patch.edits, config.fix.include);
    if (problems.length > 0) return { kind: "invalid", edits: patch.edits, problems };
    return make(patch.edits, "ai", patch.summary);
  } catch (error) {
    return { kind: "stop", result: "failed", message: `AI patch failed: ${errorMessage(error)}` };
  }
}

export type VerifyResult =
  | { kind: "done"; result: "fixed" | "unverified"; message: string }
  | { kind: "retry"; feedback: string }
  | { kind: "failed"; message: string };

/**
 * Applies edits, runs the verify commands, then re-captures the page on the dev server and
 * compares it with production. Anything short of a match reverts the edits.
 */
export async function applyAndVerify(
  config: ResolvedConfig,
  job: JobResult,
  workdir: string,
  edits: Edit[],
  options: { server?: DevServer; progress?: (message: string) => void },
): Promise<VerifyResult> {
  const progress = options.progress ?? (() => {});
  const originals = applyEdits(workdir, edits);
  progress(`Applied ${edits.length} edit${edits.length === 1 ? "" : "s"}`);

  const commands = await runCommands(
    config.fix.verify.commands,
    workdir,
    config.fix.verify.commandTimeoutMs,
  );
  for (const result of commands) progress(`${result.ok ? "✓" : "✖"} ${result.command}`);
  const failedCommand = commands.find((result) => !result.ok);
  if (failedCommand) {
    revertEdits(workdir, originals);
    return {
      kind: "retry",
      feedback: `\`${failedCommand.command}\` failed after the edit:\n${failedCommand.output}`,
    };
  }

  if (!options.server) {
    return {
      kind: "done",
      result: "unverified",
      message: "Applied but not verified: set fix.verify.server to check it visually.",
    };
  }
  try {
    await options.server.ensure();
    progress(`Re-capturing ${job.route} on ${options.server.url}`);
    const verification = await verifyAgainstProduction(config, job, options.server.url);
    if (verification.resolved) {
      const pixels = verification.job.diff?.diffPixels ?? 0;
      return {
        kind: "done",
        result: "fixed",
        message: `${job.route} now matches production (${pixels} differing pixel${pixels === 1 ? "" : "s"})`,
      };
    }
    revertEdits(workdir, originals);
    const still = verification.job.findings?.find((item) => item.severity !== "info")?.message;
    const feedback = `After the edit the page still differs from production (${((verification.job.diff?.diffRatio ?? 0) * 100).toFixed(2)}% of pixels${still ? `; ${still}` : ""}).`;
    progress(`Still differs; reverted. ${feedback}`);
    return { kind: "retry", feedback };
  } catch (error) {
    revertEdits(workdir, originals);
    return { kind: "failed", message: `Verification failed: ${errorMessage(error)}` };
  }
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
  const workdir = options.workdir ?? config.cwd;
  assertCanFix(config, workdir, options.allowDirty);

  const { dir: runDir } = findRun(config.outputDir, options.runId);
  const manifest = readManifest(runDir);
  const jobs = selectFixableJobs(manifest.jobs, options);
  if (jobs.length === 0) return [];

  const changed = config.fix.compareRef
    ? new Set(changedSince(workdir, config.fix.compareRef))
    : undefined;
  const server = config.fix.verify.server
    ? new DevServer(config.fix.verify.server, workdir, { requireFresh: options.freshServer })
    : undefined;
  const outcomes: FixOutcome[] = [];
  try {
    for (const job of jobs) {
      outcomes.push(
        await fixJob(
          config,
          prepareWorkspace(config, job, { workdir, runDir, changed }),
          options,
          server,
        ),
      );
    }
  } finally {
    await server?.stop();
  }
  return outcomes;
}

async function fixJob(
  config: ResolvedConfig,
  workspace: FixWorkspace,
  options: FixOptions,
  server: DevServer | undefined,
): Promise<FixOutcome> {
  const { job } = workspace;
  const progress = (message: string) => options.callbacks.progress(job, message);
  if (workspace.candidates.length === 0) {
    return {
      job,
      result: "skipped",
      message: "No source files matched this change (check fix.include).",
      edits: [],
      attempts: 0,
    };
  }
  progress(
    `Likely source: ${workspace.candidates
      .slice(0, 3)
      .map((candidate) => candidate.path)
      .join(", ")}`,
  );

  let feedback: string | undefined;
  let previous: Edit[] | undefined;
  for (let attempt = 1; attempt <= config.fix.maxAttempts; attempt++) {
    const proposed = await proposeEdits(config, workspace, {
      attempt,
      useHeuristic: attempt === 1,
      provider: options.provider,
      consent: options.callbacks.consent,
      progress,
      feedback,
      previous,
    });
    if (proposed.kind === "stop") {
      return {
        job,
        result: proposed.result,
        message: proposed.message,
        edits: [],
        attempts: attempt - (proposed.result === "failed" ? 0 : 1),
      };
    }
    if (proposed.kind === "invalid") {
      feedback = proposed.problems.join(" ");
      previous = proposed.edits;
      progress(`Proposed edits were invalid: ${feedback}`);
      continue;
    }

    const { proposal } = proposed;
    if (
      config.fix.requireConfirmation &&
      !options.yes &&
      !(await options.callbacks.confirm(proposal))
    ) {
      return {
        job,
        result: "rejected",
        message: "Change not applied.",
        edits: proposal.edits,
        attempts: attempt,
      };
    }
    const verified = await applyAndVerify(config, job, workspace.workdir, proposal.edits, {
      server,
      progress,
    });
    if (verified.kind === "done") {
      return {
        job,
        result: verified.result,
        message: verified.message,
        edits: proposal.edits,
        attempts: attempt,
        diff: proposal.diff,
      };
    }
    if (verified.kind === "failed") {
      return {
        job,
        result: "failed",
        message: verified.message,
        edits: proposal.edits,
        attempts: attempt,
      };
    }
    feedback = verified.feedback;
    previous = proposal.edits;
  }
  return {
    job,
    result: "failed",
    message: `No working fix after ${config.fix.maxAttempts} attempt(s)${feedback ? `: ${feedback}` : ""}. All edits were reverted.`,
    edits: previous ?? [],
    attempts: config.fix.maxAttempts,
  };
}
