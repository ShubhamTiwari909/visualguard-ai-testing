/**
 * @file Automatic Git workflow: enforce visual verification, create isolated worktree/branch,
 * commit verified edits and optionally push/open PR.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { AIProvider } from "../ai/provider.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { shortHash } from "../config/urls.js";
import { ConfigError, EnvironmentError } from "../core/errors.js";
import { findRun, readManifest } from "../core/runs.js";
import {
  createPullRequest,
  githubContext,
  type GitHubContext,
} from "../reporters/github-comment.js";
import { inlineCode } from "../reporters/markdown.js";
import { VERSION } from "../core/version.js";
import { assertCanFix, fixRegressions, hasConsent, type FixOutcome } from "./fix.js";
import { dirtyFiles, git, gitRoot } from "./git.js";

export interface AutoFixOptions {
  runId?: string;
  routes?: string[];
  viewports?: string[];
  includeReview?: boolean;
  provider?: AIProvider;
  /**
   * Work on a new branch in the current checkout instead of a separate worktree (CI).
   */
  inPlace?: boolean;
  /**
   * Push the branch and open a pull request.
   */
  pr?: boolean;
  /**
   * Base branch for the PR (default: the current branch).
   */
  base?: string;
  branch?: string;
  keepWorktree?: boolean;
  /**
   * Use the GitHub REST API even when the `gh` CLI is available.
   */
  preferAPI?: boolean;
  env?: NodeJS.ProcessEnv;
  progress?: (message: string) => void;
}

export interface AutoFixResult {
  outcomes: FixOutcome[];
  branch?: string;
  commit?: string;
  worktree?: string;
  pr?: { url: string; number?: number };
}

/**
 * Links the main checkout's node_modules into the worktree so builds and dev servers work.
 *
 * Link installed dependencies from the main checkout into an isolated repair worktree. Walk
 * relevant project ancestors so monorepo dependency locations remain available without
 * reinstalling.
 */
function linkNodeModules(repoRoot: string, worktree: string, projectDir: string): void {
  const dirs = new Set<string>();
  for (let dir = projectDir; ; dir = dirname(dir)) {
    dirs.add(dir);
    if (dir === repoRoot || dir === dirname(dir)) break;
  }
  for (const dir of dirs) {
    const source = join(dir, "node_modules");
    if (!existsSync(source)) continue;
    const target = join(worktree, relative(repoRoot, dir), "node_modules");
    if (existsSync(target) || isLink(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  }
}

/**
 * Test whether a path is a symbolic link using lstat, which inspects the link itself. Return
 * false for a missing or inaccessible path.
 */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Require a successful Git/process result and return its stdout. Throw an EnvironmentError with
 * captured diagnostic output when the prerequisite operation fails.
 */
function must(result: ReturnType<typeof git>, what: string): string {
  if (!result.ok) throw new EnvironmentError(`${what} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/**
 * owner/repo from the origin remote (GitHub SSH or HTTPS URLs).
 *
 * Extract owner/repository from a recognized GitHub SSH or HTTPS origin URL. Optional chaining
 * returns undefined when the remote does not match.
 */
export function repoFromRemote(remote: string): string | undefined {
  return remote.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1];
}

/**
 * Build Markdown describing verified repair outcomes and the source run. Only verified fixes
 * are presented as applied changes.
 */
function pullRequestBody(outcomes: FixOutcome[], runNumber: number): string {
  const applied = outcomes.filter((outcome) => outcome.result === "fixed");
  const lines = [
    "## 🤖 VisualGuard fixes",
    "",
    `Fixes for visual regressions found in VisualGuard run #${runNumber}.`,
    "",
    "| Route | Viewport | Result |",
    "| ----- | -------- | ------ |",
    ...outcomes.map(
      (outcome) =>
        `| ${inlineCode(outcome.job.route)} | ${outcome.job.viewport} | ${outcome.result}: ${outcome.message.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  for (const outcome of applied) {
    if (!outcome.diff) continue;
    lines.push(
      `<details><summary>${outcome.job.route} · ${outcome.job.viewport}</summary>`,
      "",
      "```diff",
      outcome.diff,
      "```",
      "",
      "</details>",
      "",
    );
  }
  lines.push(`<sub>Generated by VisualGuard ${VERSION}. Review the diff before merging.</sub>`);
  return lines.join("\n");
}

/**
 * Check whether GitHub CLI can authenticate in the supplied working directory/environment.
 * Inspect the process status instead of parsing its display text.
 */
function ghAvailable(cwd: string, env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync("gh", ["auth", "status"], { cwd, env, encoding: "utf8" });
  return result.status === 0;
}

/**
 * Non-interactive fixing (PLAN.md §13.1, `fix --auto`): fixes run in a separate git worktree on
 * a new branch, so the current checkout is untouched; verified changes are committed, and with
 * `pr` the branch is pushed and a pull request opened.
 *
 * Create an isolated repair branch/worktree, apply verified fixes and optionally
 * commit/push/open a PR. Coordinate dependency links, Git operations and cleanup so the
 * workflow can report its concrete result.
 */
export async function autoFix(
  config: ResolvedConfig,
  options: AutoFixOptions,
): Promise<AutoFixResult> {
  const env = options.env ?? process.env;
  const progress = options.progress ?? (() => {});
  const repoRoot = gitRoot(config.cwd);
  if (!repoRoot) throw new ConfigError("`visualguard fix --auto` needs a git repository.");
  // git reports resolved paths (e.g. /private/var on macOS), so compare against the real cwd.
  const projectDir = realpathSync(config.cwd);
  assertCanFix(config, config.cwd, !options.inPlace);
  if (!config.fix.verify.server) {
    throw new ConfigError("Automatic fixing requires fix.verify.server for visual verification.", {
      hint: "Configure a local verification server before using --auto.",
    });
  }
  if (options.provider && !hasConsent(config, options.provider)) {
    throw new ConfigError(`Sending source code to ${options.provider.name} hasn't been allowed.`, {
      hint: "Run `visualguard fix` once in a terminal and allow it, or set fix.allowSourceUpload: true.",
    });
  }
  if (!options.inPlace && dirtyFiles(config.cwd).length > 0) {
    progress("Uncommitted changes in the current checkout are not part of the fix worktree.");
  }

  const { dir: runDir } = findRun(config.outputDir, options.runId);
  const manifest = readManifest(runDir);
  const branch = options.branch ?? `visualguard/fix-${manifest.number}-${shortHash(manifest.id)}`;
  const base =
    options.base ?? (git(config.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "main");

  let worktree: string | undefined;
  let workdir = config.cwd;
  if (options.inPlace) {
    must(git(config.cwd, ["checkout", "-b", branch]), `Creating branch ${branch}`);
  } else {
    worktree = join(config.outputDir, "worktrees", branch.replace(/[^\w.-]+/g, "-"));
    rmSync(worktree, { recursive: true, force: true });
    must(
      git(repoRoot, ["worktree", "add", "-b", branch, worktree, "HEAD"]),
      "Creating the fix worktree",
    );
    workdir = join(worktree, relative(repoRoot, projectDir));
    linkNodeModules(repoRoot, worktree, projectDir);
    progress(`Working in ${relative(config.cwd, workdir) || "."} on branch ${branch}`);
  }

  /**
   * Remove temporary repair workspace state according to retention options and outcome. This
   * helper can also restore the original checkout and remove the temporary branch when
   * requested.
   */
  const cleanup = (removeBranch: boolean) => {
    if (worktree && !options.keepWorktree) {
      git(repoRoot, ["worktree", "remove", "--force", worktree]);
      rmSync(worktree, { recursive: true, force: true });
      git(repoRoot, ["worktree", "prune"]);
    }
    if (removeBranch) {
      if (options.inPlace) git(config.cwd, ["checkout", base]);
      git(repoRoot, ["branch", "-D", branch]);
    }
  };

  let outcomes: FixOutcome[];
  try {
    outcomes = await fixRegressions(config, {
      runId: options.runId,
      routes: options.routes,
      viewports: options.viewports,
      includeReview: options.includeReview,
      provider: options.provider,
      workdir,
      yes: true,
      allowDirty: !options.inPlace,
      freshServer: Boolean(worktree),
      callbacks: {
        /**
         * Approve validated proposals in the explicitly automatic repair workflow. Verification
         * still decides whether edits are retained.
         */
        confirm: async () => true,
        /**
         * Decline an interactive source-upload prompt in automatic mode. AI upload therefore
         * requires prior consent or explicit configuration.
         */
        consent: async () => false,
        /**
         * Prefix each repair progress message with route and viewport before forwarding it.
         */
        progress: (job, message) => progress(`${job.route} ${job.viewport}: ${message}`),
      },
    });
  } catch (error) {
    cleanup(true);
    throw error;
  }

  const applied = outcomes.filter((outcome) => outcome.result === "fixed");
  if (applied.length === 0) {
    cleanup(true);
    return { outcomes };
  }

  const files = [...new Set(applied.flatMap((outcome) => outcome.edits.map((edit) => edit.file)))];
  must(git(workdir, ["add", "--", ...files]), "Staging the fixes");
  const subject =
    applied.length === 1
      ? `fix(visual): restore ${applied[0]!.job.route}`
      : `fix(visual): restore ${applied.length} pages`;
  const body = applied
    .map((outcome) => `- ${outcome.job.route} (${outcome.job.viewport}): ${outcome.message}`)
    .join("\n");
  must(
    git(workdir, [
      "commit",
      "-m",
      subject,
      "-m",
      `${body}\n\nGenerated by VisualGuard from run #${manifest.number}.`,
    ]),
    "Committing the fixes",
  );
  const commit = must(git(workdir, ["rev-parse", "HEAD"]), "Reading the commit");

  let pr: AutoFixResult["pr"];
  if (options.pr) {
    must(git(workdir, ["push", "-u", "origin", branch]), `Pushing ${branch}`);
    const title = subject.replace(/^fix\(visual\): /, "Fix visual regressions: ");
    const prBody = pullRequestBody(outcomes, manifest.number);
    if (!options.preferAPI && ghAvailable(workdir, env)) {
      const created = spawnSync(
        "gh",
        ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", prBody],
        {
          cwd: workdir,
          env,
          encoding: "utf8",
        },
      );
      if (created.status !== 0)
        throw new EnvironmentError(`gh pr create failed: ${created.stderr.trim()}`);
      pr = { url: created.stdout.trim().split("\n").pop()! };
    } else {
      const remote = git(workdir, ["remote", "get-url", "origin"]).stdout;
      const context: GitHubContext = githubContext(env, {
        repo: env.GITHUB_REPOSITORY ?? repoFromRemote(remote),
      });
      const created = await createPullRequest(context, { title, body: prBody, head: branch, base });
      pr = { url: created.url, number: created.number };
    }
    progress(`Opened ${pr.url}`);
  }

  cleanup(false);
  return { outcomes, branch, commit, worktree: options.keepWorktree ? worktree : undefined, pr };
}
