/**
 * @file Repair coordinator: choose jobs, obtain proposals/consent, confirm/apply/verify/retry,
 * record artifacts and verify final batch scope.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

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
import { AIBudget, budgetedProvider, restoreRunUsage, persistRunUsage } from "../ai/budget.js";
import { sourceRevision } from "../core/provenance.js";
import { DevServer, runCommands, verifyAgainstProduction } from "./verify.js";

export interface Proposal {
  job: JobResult;
  edits: Edit[];
  diff: string;
  source: "heuristic" | "ai";
  summary: string;
  attempt: number;
  candidates: Candidate[];
  usage?: import("../ai/provider.js").Usage;
  confidence?: number;
  originals: Map<string, string>;
}

export type FixResult = "fixed" | "unverified" | "rejected" | "failed" | "skipped";

export interface FixOutcome {
  job: JobResult;
  result: FixResult;
  message: string;
  edits: Edit[];
  attempts: number;
  /**
   * Diff of the applied change (fixed or unverified).
   */
  diff?: string;
}

export interface FixCallbacks {
  /**
   * Return false to skip this proposal. Not called when confirmation is off.
   */
  confirm(proposal: Proposal): Promise<boolean>;
  /**
   * Asked once before source excerpts are first sent to an AI provider.
   */
  consent(files: string[], provider: AIProvider): Promise<boolean>;
  progress(job: JobResult, message: string): void;
}

export interface FixOptions {
  runId?: string;
  routes?: string[];
  viewports?: string[];
  /**
   * Also try jobs marked review (default: regressions only).
   */
  includeReview?: boolean;
  allowDirty?: boolean;
  /**
   * Skip the confirmation prompt.
   */
  yes?: boolean;
  provider?: AIProvider;
  signal?: AbortSignal;
  callbacks: FixCallbacks;
  /**
   * Project directory to edit; defaults to config.cwd (a worktree in --auto mode).
   */
  workdir?: string;
  /**
   * In a worktree, the dev server must be started here, not reused from the main checkout.
   */
  freshServer?: boolean;
}

/**
 * Return the provider-consent JSON path under this project's output directory. Consent is local
 * workspace metadata used by the repair flow.
 */
const consentPath = (config: ResolvedConfig) => join(config.outputDir, "consent.json");

/**
 * Check explicit source-upload configuration or saved consent for this provider name. Missing
 * or invalid consent records return false.
 */
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

/**
 * Add the provider to the saved consent set and persist the grant timestamp. A Set preserves
 * prior providers while preventing duplicate names.
 */
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

/**
 * Jobs from a run that `fix` should work on.
 *
 * Filter jobs by repairable verdict, evidence and optional route/viewport selection. Review
 * jobs are included only when the caller opts into that scope.
 */
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
 * Require enabled fixing and an acceptable workspace state before proposing changes.
 * Dirty-source policy is checked here so subsequent writes follow the requested protection.
 */
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

/**
 * Everything the fixer knows about one job's source.
 */
export interface FixWorkspace {
  job: JobResult;
  workdir: string;
  runDir: string;
  files: SourceFile[];
  clues: Clues;
  candidates: Candidate[];
}

/**
 * Collect allowed files, captured clues and ranked source candidates for one job. Return this
 * context without writing source, ready for deterministic or AI proposal generation.
 */
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
 * One proposal: the deterministic patch when allowed and possible, otherwise the AI's. Edits
 * are validated against the files before they are returned.
 *
 * Try a permitted deterministic repair first, otherwise request an AI patch after source-upload
 * consent. Validate candidate edits and return either a reviewable proposal or an explicit stop
 * outcome.
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
  /**
   * Package validated edits with a readable diff, attempt number and original source snapshots.
   * The snapshots allow application to detect files changed since proposal preparation.
   */
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
      originals: new Map(workspace.files.map((file) => [file.path, file.content])),
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
    for (const edit of patch.edits)
      if (!candidates.some((candidate) => candidate.path === edit.file))
        problems.push(
          `${edit.file} was not supplied to the model; edit only the shown source files.`,
        );
    if (problems.length > 0) return { kind: "invalid", edits: patch.edits, problems };
    const proposed = make(patch.edits, "ai", patch.summary);
    if (proposed.kind === "proposal") {
      proposed.proposal.usage = patch.usage;
      proposed.proposal.confidence = patch.confidence;
    }
    return proposed;
  } catch (error) {
    return { kind: "stop", result: "failed", message: `AI patch failed: ${errorMessage(error)}` };
  }
}

export type VerifyResult = (
  | { kind: "done"; result: "fixed" | "unverified"; message: string }
  | { kind: "retry"; feedback: string }
  | { kind: "failed"; message: string }
) & { commands?: import("./verify.js").CommandResult[]; verificationDir?: string };

/**
 * Applies edits, runs the verify commands, then re-captures the page on the dev server and
 * compares it with production. Anything short of a match reverts the edits.
 *
 * Apply a proposal, run configured verification commands and compare a fresh local capture
 * against the reference. Restore originals when verification fails, throws or is cancelled.
 */
export async function applyAndVerify(
  config: ResolvedConfig,
  job: JobResult,
  workdir: string,
  edits: Edit[],
  options: {
    server?: DevServer;
    progress?: (message: string) => void;
    runDir?: string;
    originals?: ReadonlyMap<string, string>;
    signal?: AbortSignal;
    scope?: JobResult[];
  },
): Promise<VerifyResult> {
  const progress = options.progress ?? (() => {});
  options.signal?.throwIfAborted();
  const problems = validateEdits(workdir, edits, config.fix.include);
  if (problems.length) return { kind: "failed", message: problems.join(" ") };
  let originals: Map<string, string>;
  try {
    originals = applyEdits(workdir, edits, options.originals);
  } catch (error) {
    return { kind: "failed", message: errorMessage(error) };
  }
  try {
    progress(`Applied ${edits.length} edit${edits.length === 1 ? "" : "s"}`);

    const commands = await runCommands(
      config.fix.verify.commands,
      workdir,
      config.fix.verify.commandTimeoutMs,
      options.signal,
    );
    options.signal?.throwIfAborted();
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
        commands,
        result: "unverified",
        message: "Applied but not verified: set fix.verify.server to check it visually.",
      };
    }
    await options.server.ensure(options.signal);
    progress(`Re-capturing ${job.route} on ${options.server.url}`);
    const verification = await verifyAgainstProduction(
      config,
      job,
      options.server.url,
      options.runDir,
      options.signal,
    );
    if (verification.resolved && options.scope) {
      for (const original of options.scope) {
        if (original.id === job.id) continue;
        const reference =
          original.route === job.route && original.status !== "accepted"
            ? original.captures.production
            : original.captures.staging;
        if (!reference) throw new Error(`Missing scope reference: ${original.id}`);
        const collateral = await verifyAgainstProduction(
          config,
          { ...original, captures: { ...original.captures, production: reference } },
          options.server.url,
          options.runDir,
          options.signal,
        );
        if (!collateral.resolved) {
          revertEdits(workdir, originals);
          return {
            kind: "retry",
            feedback: `Collateral change on ${original.route} (${original.viewport}); reverted.`,
            commands,
            verificationDir: collateral.runDir,
          };
        }
      }
    }
    if (verification.resolved) {
      const pixels = verification.job.diff?.diffPixels ?? 0;
      return {
        kind: "done",
        commands,
        verificationDir: verification.runDir,
        result: "fixed",
        message: `${job.route} now matches production (${pixels} differing pixel${pixels === 1 ? "" : "s"})`,
      };
    }
    revertEdits(workdir, originals);
    const still = verification.job.findings?.find((item) => item.severity !== "info")?.message;
    const feedback = `After the edit the page still differs from production (${((verification.job.diff?.diffRatio ?? 0) * 100).toFixed(2)}% of pixels${still ? `; ${still}` : ""}).`;
    progress(`Still differs; reverted. ${feedback}`);
    return { kind: "retry", feedback, commands, verificationDir: verification.runDir };
  } catch (error) {
    revertEdits(workdir, originals);
    return { kind: "failed", message: `Verification failed: ${errorMessage(error)}` };
  }
}

/**
 * The fix loop (PLAN.md §13.2): locate source → propose edits (deterministic first, then AI) →
 * validate → confirm → apply → run commands → re-capture on the local server and compare with
 * production → keep, or revert and retry with feedback.
 *
 * Coordinate source location, proposal review and bounded repair attempts for selected jobs.
 * Share usage/server resources across attempts and stop managed servers in finally.
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
  const budget = new AIBudget(config.ai, options.signal);
  restoreRunUsage(budget, runDir, manifest.usage);
  const fixOptions = {
    ...options,
    provider: options.provider ? budgetedProvider(options.provider, budget) : undefined,
  };
  const batchOriginals = new Map(
    listSourceFiles(workdir, config.fix.include).map((file) => [file.path, file.content]),
  );
  const verificationRuns: string[] = [];
  try {
    for (const job of jobs) {
      options.signal?.throwIfAborted();
      outcomes.push(
        await fixJob(
          config,
          prepareWorkspace(config, job, { workdir, runDir, changed }),
          fixOptions,
          server,
        ),
      );
    }
    const fixed = new Set(outcomes.filter((o) => o.result === "fixed").map((o) => o.job.id));
    const fixedRoutes = new Set(
      outcomes.filter((o) => o.result === "fixed").map((o) => o.job.route),
    );
    if (server && fixed.size) {
      // Conservative full original-run scope: unresolved/intentional pages must retain their
      // pre-fix staging look, and repaired pages must retain the expected reference look.
      for (const original of manifest.jobs) {
        options.signal?.throwIfAborted();
        const target =
          fixed.has(original.id) ||
          (fixedRoutes.has(original.route) && original.status !== "accepted");
        const reference = target ? original.captures.production : original.captures.staging;
        if (!reference) throw new Error(`Missing reference for final verification: ${original.id}`);
        const check = await verifyAgainstProduction(
          config,
          { ...original, captures: { ...original.captures, production: reference } },
          server.url,
          runDir,
          options.signal,
        );
        verificationRuns.push(check.runDir);
        if (check.resolved && target) {
          const already = outcomes.find((o) => o.job.id === original.id && o.result === "skipped");
          if (already) {
            already.result = "fixed";
            already.message =
              "Resolved by another edit in this batch and verified against the saved reference.";
          }
        }
        if (!check.resolved) {
          const edited = new Set(
            outcomes
              .filter((o) => o.result === "fixed")
              .flatMap((o) => o.edits.map((e) => e.file.replace(/^\.\//, ""))),
          );
          revertEdits(workdir, new Map([...batchOriginals].filter(([path]) => edited.has(path))));
          for (const outcome of outcomes)
            if (outcome.result === "fixed") {
              outcome.result = "failed";
              outcome.message = `Batch verification failed on ${original.route} (${original.viewport}); all batch edits reverted.`;
            }
          break;
        }
      }
    }
  } catch (error) {
    const edited = new Set(
      outcomes
        .filter((o) => o.result === "fixed" || o.result === "unverified")
        .flatMap((o) => o.edits.map((e) => e.file.replace(/^\.\//, ""))),
    );
    revertEdits(workdir, new Map([...batchOriginals].filter(([path]) => edited.has(path))));
    throw error;
  } finally {
    try {
      persistRunUsage(budget, runDir);
      writeFileSync(
        join(runDir, "fix-results.json"),
        JSON.stringify(
          {
            version: 1,
            sourceRevision: sourceRevision(workdir),
            referenceRun: manifest.id,
            usage: budget.snapshot(),
            verificationRuns,
            outcomes,
          },
          null,
          2,
        ),
      );
    } finally {
      await server?.stop();
    }
  }
  return outcomes;
}

/**
 * Attempt one job's repair, feeding failed verification evidence into subsequent proposals.
 * Keep only verified changes and return a structured outcome with attempts/edits.
 */
async function fixJob(
  config: ResolvedConfig,
  workspace: FixWorkspace,
  options: FixOptions,
  server: DevServer | undefined,
): Promise<FixOutcome> {
  const { job } = workspace;
  /**
   * Forward a repair progress message with its job identity to the caller's callback. This
   * closure supplies the job so individual steps only need to provide text.
   */
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
    mkdirSync(join(workspace.runDir, "fixes"), { recursive: true });
    writeFileSync(
      join(workspace.runDir, "fixes", `${job.id}-${attempt}.json`),
      JSON.stringify(
        {
          ...proposal,
          originals: undefined,
          sourceRevision: sourceRevision(workspace.workdir),
          referenceRun: workspace.runDir,
        },
        null,
        2,
      ),
    );
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
      runDir: workspace.runDir,
      originals: proposal.originals,
      signal: options.signal,
    });
    try {
      writeFileSync(
        join(workspace.runDir, "fixes", `${job.id}-${attempt}.verification.json`),
        JSON.stringify(verified, null, 2),
      );
    } catch (error) {
      if (verified.kind === "done")
        revertEdits(
          workspace.workdir,
          new Map(
            [...proposal.originals].filter(([path]) =>
              proposal.edits.some((edit) => edit.file.replace(/^\.\//, "") === path),
            ),
          ),
        );
      throw error;
    }
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
