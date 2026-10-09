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
}

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
    .option("--ci", "no colours")
    .option("--json", "print the merged manifest JSON to stdout")
    .option("--junit <path>", "write a JUnit XML report")
    .action(async (paths: string[], flags: MergeFlags) => {
      process.exitCode = await runMergeCommand(paths, flags);
    });
}

export async function runMergeCommand(paths: string[], flags: MergeFlags): Promise<number> {
  const config = await loadResolvedConfig(flags);
  const { manifest } = await mergeRuns(config, paths, {
    reporters: standardReporters(config, flags),
  });
  return exitCodeFor(manifest, flags.failOn);
}
