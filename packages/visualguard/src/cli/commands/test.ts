import { Option, type Command } from "commander";
import pc from "picocolors";
import type { ResolvedConfig } from "../../config/resolve.js";
import { planJobs } from "../../core/jobs.js";
import { createRun, type Reporter } from "../../core/run.js";
import { exitCodeFor, FAIL_ON_VALUES } from "../../core/status.js";
import type { FailOn } from "../../core/types.js";
import { pluralize } from "../../core/util.js";
import {
  collect,
  loadResolvedConfig,
  parsePositiveInt,
  requireCompareURLs,
  standardReporters,
  type ConfigFlags,
} from "../shared.js";

export interface TestFlags extends ConfigFlags {
  failOn: FailOn;
  ci?: boolean;
  json?: boolean;
  debug?: boolean;
  list?: boolean;
}

export function addConfigOptions(command: Command): Command {
  return command
    .option("-c, --config <path>", "config file path")
    .option("--production <url>", "override the production base URL")
    .option("--staging <url>", "override the staging base URL, e.g. http://localhost:3000")
    .option(
      "--route <path>",
      "test only this path; repeatable, replaces configured routes",
      collect,
    )
    .option("--only <glob>", 'filter routes, e.g. --only "/blog/**"; repeatable', collect)
    .option("--viewport <name>", "run only this viewport; repeatable", collect)
    .option("--concurrency <n>", "pages captured in parallel", parsePositiveInt);
}

export function registerTestCommand(program: Command): void {
  const command = program
    .command("test")
    .description("capture production and staging, diff every route, and report the differences");
  addConfigOptions(command)
    .addOption(
      new Option("--fail-on <level>", "what makes the exit code non-zero")
        .choices(FAIL_ON_VALUES as string[])
        .default("regression"),
    )
    .option("--ci", "no prompts, colours or spinners")
    .option("--json", "print the manifest JSON to stdout")
    .option("--debug", "save Playwright traces")
    .option("--list", "print the resolved URL pairs and exit without capturing")
    .action(async (flags: TestFlags) => {
      process.exitCode = await runTestCommand(flags);
    });
}

export async function runTestCommand(
  flags: TestFlags,
  reporters: Reporter[] = [],
): Promise<number> {
  const config = await loadResolvedConfig(flags);
  requireCompareURLs(config);

  if (flags.list) {
    await printJobList(config);
    return 0;
  }

  const allReporters: Reporter[] = [...standardReporters(config, flags), ...reporters];

  const { manifest } = await createRun(config, {
    failOn: flags.failOn,
    debug: flags.debug,
    reporters: allReporters,
  }).start();
  return exitCodeFor(manifest, flags.failOn);
}

/** `--list`: show what would run, without opening a browser (PLAN.md §6.5). */
export async function printJobList(
  config: ResolvedConfig,
  stream: NodeJS.WritableStream = process.stdout,
) {
  const plan = await planJobs(config);
  const write = (line = "") => stream.write(`${line}\n`);
  const width = Math.max(12, ...plan.routes.map((route) => route.paths.production.length));

  write();
  write(`  ${pc.dim("production")}   ${config.baseURL.production}`);
  write(`  ${pc.dim("staging   ")}   ${config.baseURL.staging}`);
  write(`  ${pc.dim("viewports ")}   ${Object.keys(config.viewports).join(", ")}`);
  write();
  for (const route of plan.routes) {
    write(`  ${route.paths.production.padEnd(width)}  →  ${route.paths.staging}`);
  }
  if (plan.warnings.length > 0) write();
  for (const warning of plan.warnings) write(pc.yellow(`  ⚠ ${warning}`));
  write();
  const viewportCount = Object.keys(config.viewports).length;
  write(
    `  ${pluralize(plan.jobs.length, "job")} (${pluralize(plan.routes.length, "route")} × ${pluralize(viewportCount, "viewport")})`,
  );
  write();
}
