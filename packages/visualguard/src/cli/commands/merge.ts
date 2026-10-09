/**
 * @file CLI wrapper for shard merge, reporting and incomplete/failing exit policy.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { Option, type Command } from "commander";
import { mergeRuns } from "../../core/merge.js";
import { exitCodeFor, FAIL_ON_VALUES } from "../../core/status.js";
import type { FailOn } from "../../core/types.js";
import { loadResolvedConfig, standardReporters } from "../shared.js";

export interface MergeFlags {
  config?: string;
  failOn: FailOn;
  ci?: boolean;
  json?: boolean;
  junit?: string;
  allowPartial?: boolean;
}

/**
 * Register the merge command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerMergeCommand(program: Command): void {
  program
    .command("merge")
    .description("combine the runs of `test --shard` jobs into one run, report and exit code")
    .argument(
      "<paths...>",
      "run directories, .visualguard folders, or a folder of downloaded CI artifacts",
    )
    .option("-c, --config <path>", "config file path")
    .addOption(
      new Option("--fail-on <level>", "what makes the exit code non-zero")
        .choices(FAIL_ON_VALUES as string[])
        .default("regression"),
    )
    .option(
      "--allow-partial",
      "emit an incomplete report when shards or jobs are missing (nonzero exit)",
    )
    .option("--ci", "no colours")
    .option("--json", "print the merged manifest JSON to stdout")
    .option("--junit <path>", "write a JUnit XML report")
    .action(async (paths: string[], flags: MergeFlags) => {
      process.exitCode = await runMergeCommand(paths, flags);
    });
}

/**
 * Merge supplied shard runs with the configured reporters and return their combined exit code.
 * An incomplete merge explicitly fails even if its available jobs are passing.
 */
export async function runMergeCommand(paths: string[], flags: MergeFlags): Promise<number> {
  const config = await loadResolvedConfig(flags);
  const { manifest } = await mergeRuns(config, paths, {
    allowPartial: flags.allowPartial,
    reporters: standardReporters(config, flags),
  });
  return manifest.incomplete ? 1 : exitCodeFor(manifest, flags.failOn);
}
