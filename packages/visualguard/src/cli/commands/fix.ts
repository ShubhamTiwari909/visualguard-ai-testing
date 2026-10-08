import * as p from "@clack/prompts";
import type { Command } from "commander";
import pc from "picocolors";
import { createProvider } from "../../ai/factory.js";
import type { AIProvider } from "../../ai/provider.js";
import { ExitCode } from "../../core/errors.js";
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
}

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
    );
  addAIOptions(command).action(async (routes: string[], flags: FixFlags) => {
    process.exitCode = await runFixCommand(routes, flags);
  });
}

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

function cancelled<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Stopped. Changes already verified stay in place.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

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

  p.intro(pc.bgCyan(pc.black(" VisualGuard fix ")));
  const interactive = process.stdin.isTTY && !isCI();

  const callbacks: FixCallbacks = {
    progress: (job, message) =>
      p.log.step(`${pc.bold(job.route)} ${pc.dim(job.viewport)}  ${message}`),
    async confirm(proposal: Proposal) {
      const files = [...new Set(proposal.edits.map((edit) => edit.file))];
      p.note(
        `${pc.bold("Reason")}\n${proposal.summary || proposal.edits.map((edit) => edit.reason).join("\n")}\n\n${colorDiff(proposal.diff)}`,
        `VisualGuard wants to modify ${files.join(", ")}${proposal.source === "ai" ? ` · proposed by ${provider?.name}` : " · deterministic"}`,
      );
      if (!interactive) return false;
      return cancelled(await p.confirm({ message: "Apply this change?", initialValue: false }));
    },
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

function printSummary(outcomes: FixOutcome[]): void {
  const lines = outcomes.map((outcome) => {
    const style = RESULT_STYLE[outcome.result];
    return `${style(outcome.result.toUpperCase().padEnd(10))} ${outcome.job.route} ${pc.dim(outcome.job.viewport)}  ${pc.dim(outcome.message)}`;
  });
  p.note(lines.join("\n"), "Summary");
}
