/**
 * @file CLI repair prompts, source-upload consent and progress; dispatches interactive or
 * automatic fixing.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import * as p from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";
import { createProvider } from "../../ai/factory.js";
import type { AIProvider } from "../../ai/provider.js";
import { ConfigError, ExitCode } from "../../core/errors.js";
import { autoFix } from "../../fixer/auto.js";
import {
  fixRegressions,
  type FixCallbacks,
  type FixOutcome,
  type Proposal,
} from "../../fixer/fix.js";
import { addAIOptions, collect, isCI, loadResolvedConfig, type ConfigFlags } from "../shared.js";

export interface FixFlags extends Pick<ConfigFlags, "config" | "provider" | "model"> {
  run?: string;
  viewport?: string[];
  includeReview?: boolean;
  allowDirty?: boolean;
  yes?: boolean;
  ai?: boolean;
  auto?: boolean;
  pr?: boolean;
  base?: string;
  branch?: string;
  inPlace?: boolean;
  keepWorktree?: boolean;
}

/**
 * Register the fix command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerFixCommand(program: Command): void {
  const command = program
    .command("fix")
    .description(
      "propose, apply and visually verify fixes for regressions (asks before every change)",
    )
    .argument("[routes...]", "routes or globs to fix (default: every regression in the run)")
    .option("-c, --config <path>", "config file path")
    .option("--run <id>", "run id, id prefix or run number (default: latest)")
    .option("--viewport <name>", "only this viewport; repeatable", collect)
    .option("--include-review", "also try changes marked review")
    .option("--allow-dirty", "allow uncommitted changes in the working tree")
    .option(
      "-y, --yes",
      "apply without asking (only when fix.requireConfirmation is false or you're sure)",
    )
    .option(
      "--auto",
      "no prompts: fix on a new branch in a separate git worktree and commit verified fixes",
    )
    .option("--pr", "with --auto: push the branch and open a pull request")
    .option("--base <branch>", "with --pr: base branch (default: the current branch)")
    .option("--branch <name>", "with --auto: branch name (default: visualguard/fix-<run>-<id>)")
    .option("--in-place", "with --auto: use the current checkout instead of a worktree (CI)")
    .option("--keep-worktree", "with --auto: keep the worktree for inspection");
  addAIOptions(command).action(async (routes: string[], flags: FixFlags) => {
    process.exitCode = await runFixCommand(routes, flags);
  });
}

/**
 * Color added, removed and hunk lines in a unified diff. File headers beginning with +++ or ---
 * are not treated as changed source lines.
 */
const colorDiff = (diff: string) =>
  diff
    .split("\n")
    .map((line) =>
      line.startsWith("+") && !line.startsWith("+++")
        ? pc.green(line)
        : line.startsWith("-") && !line.startsWith("---")
          ? pc.red(line)
          : line.startsWith("@@")
            ? pc.cyan(line)
            : pc.dim(line),
    )
    .join("\n");

/**
 * Recognize the prompt library's cancellation sentinel and end the interactive command cleanly.
 * Otherwise return the selected answer with the sentinel excluded from its TypeScript type.
 */
function cancelled<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Stopped. Changes already verified stay in place.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

/**
 * Resolve the provider and run, then coordinate consent, proposal review, application and
 * verification. Return an exit code based on the repair outcomes instead of assuming a proposed
 * patch succeeded.
 */
export async function runFixCommand(routes: string[], flags: FixFlags): Promise<number> {
  const config = await loadResolvedConfig({
    config: flags.config,
    provider: flags.provider,
    model: flags.model,
  });
  let provider: AIProvider | undefined;
  if (flags.ai !== false) {
    const created = createProvider(config.ai);
    provider = created.provider;
    if (!provider && created.reason)
      p.log.warn(`AI off: ${created.reason}. Only deterministic fixes are possible.`);
  }
  if (flags.auto) return runAutoFix(routes, flags, config, provider);
  if (flags.pr || flags.inPlace || flags.branch || flags.keepWorktree) {
    throw new ConfigError("--pr, --branch, --in-place and --keep-worktree need --auto.");
  }

  p.intro(pc.bgCyan(pc.black(" VisualGuard fix ")));
  const interactive = process.stdin.isTTY && !isCI();

  const callbacks: FixCallbacks = {
    /**
     * Render interactive repair progress for the supplied job.
     */
    progress: (job, message) =>
      p.log.step(`${pc.bold(job.route)} ${pc.dim(job.viewport)}  ${message}`),
    /**
     * Show a proposal's files, rationale and diff, then ask whether it should be applied.
     * Declining returns false to the fixer so the source remains unmodified by that proposal.
     */
    async confirm(proposal: Proposal) {
      const files = [...new Set(proposal.edits.map((edit) => edit.file))];
      p.note(
        `${pc.bold("Reason")}\n${proposal.summary || proposal.edits.map((edit) => edit.reason).join("\n")}\n\n${colorDiff(proposal.diff)}`,
        `VisualGuard wants to modify ${files.join(", ")}${proposal.source === "ai" ? ` · proposed by ${provider?.name}` : " · deterministic"}`,
      );
      if (!interactive) return false;
      return cancelled(await p.confirm({ message: "Apply this change?", initialValue: false }));
    },
    /**
     * Explain which source excerpts would be sent to the chosen provider and request consent.
     * This is distinct from approving the eventual file edits.
     */
    async consent(files, chosen) {
      p.note(
        `To propose a patch, VisualGuard sends excerpts of these files to ${chosen.name} (${chosen.model}):\n${files.map((file) => `  ${file}`).join("\n")}\n\nYour answer is remembered in .visualguard/consent.json.`,
        "Send source code to the AI provider?",
      );
      if (!interactive) return false;
      return cancelled(
        await p.confirm({
          message: `Allow sending source excerpts to ${chosen.name}?`,
          initialValue: false,
        }),
      );
    },
  };

  const outcomes = await fixRegressions(config, {
    runId: flags.run,
    routes,
    viewports: flags.viewport,
    includeReview: flags.includeReview,
    allowDirty: flags.allowDirty,
    yes: flags.yes,
    provider,
    callbacks,
  });

  if (outcomes.length === 0) {
    p.outro("No regressions to fix in this run.");
    return ExitCode.Ok;
  }
  printSummary(outcomes);
  const applied = outcomes.some(
    (outcome) => outcome.result === "fixed" || outcome.result === "unverified",
  );
  p.outro(
    applied
      ? `Review the changes with ${pc.cyan("git diff")}, then commit them.`
      : "No changes were applied.",
  );
  return outcomes.every((outcome) => outcome.result === "fixed") ? ExitCode.Ok : ExitCode.Failed;
}

const RESULT_STYLE: Record<FixOutcome["result"], (text: string) => string> = {
  fixed: pc.green,
  unverified: pc.yellow,
  rejected: pc.dim,
  skipped: pc.dim,
  failed: pc.red,
};

/**
 * Render one result line per attempted job using the outcome's style. A skipped or unverified
 * proposal stays distinguishable from a verified fix.
 */
function printSummary(outcomes: FixOutcome[]): void {
  const lines = outcomes.map((outcome) => {
    const style = RESULT_STYLE[outcome.result];
    return `${style(outcome.result.toUpperCase().padEnd(10))} ${outcome.job.route} ${pc.dim(outcome.job.viewport)}  ${pc.dim(outcome.message)}`;
  });
  p.note(lines.join("\n"), "Summary");
}

/**
 * Run the automatic repair workflow in its managed workspace and print its outcomes. Translate
 * the final set of verified repairs into a CLI exit code.
 */
async function runAutoFix(
  routes: string[],
  flags: FixFlags,
  config: Awaited<ReturnType<typeof loadResolvedConfig>>,
  provider: AIProvider | undefined,
): Promise<number> {
  /**
   * Append a newline when writing automated-fix progress to stdout. Keeping this local helper
   * centralizes the output formatting.
   */
  const write = (line = "") => process.stdout.write(`${line}\n`);
  write(`VisualGuard fix --auto${flags.pr ? " --pr" : ""}`);
  const result = await autoFix(config, {
    runId: flags.run,
    routes,
    viewports: flags.viewport,
    includeReview: flags.includeReview,
    provider,
    inPlace: flags.inPlace,
    pr: flags.pr,
    base: flags.base,
    branch: flags.branch,
    keepWorktree: flags.keepWorktree,
    /**
     * Write automatic repair progress through this command's local line writer.
     */
    progress: (message) => write(`  ${message}`),
  });
  write();
  for (const outcome of result.outcomes) {
    write(
      `  ${outcome.result.toUpperCase().padEnd(10)} ${outcome.job.route} ${outcome.job.viewport}  ${outcome.message}`,
    );
  }
  write();
  if (result.commit) write(`  Committed ${result.commit.slice(0, 7)} on ${result.branch}`);
  if (result.pr) write(`  Pull request: ${result.pr.url}`);
  if (result.worktree) write(`  Worktree kept at ${result.worktree}`);
  if (result.outcomes.length === 0) write("  No regressions to fix in this run.");
  else if (!result.commit) write("  No fix could be verified; nothing was committed.");
  write();
  return result.outcomes.length > 0 &&
    result.outcomes.every((outcome) => outcome.result === "fixed")
    ? ExitCode.Ok
    : ExitCode.Failed;
}
