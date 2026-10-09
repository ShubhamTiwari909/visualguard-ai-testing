import { resolve } from "node:path";
import { Option, type Command } from "commander";
import { ConfigError } from "../../core/errors.js";
import pc from "picocolors";
import type { ResolvedConfig } from "../../config/resolve.js";
import { planJobs } from "../../core/jobs.js";
import { createRun, parseShard, type Reporter, type Shard } from "../../core/run.js";
import { exitCodeFor, FAIL_ON_VALUES } from "../../core/status.js";
import type { FailOn } from "../../core/types.js";
import { pluralize } from "../../core/util.js";
import {
  addAIOptions,
  addCheckOptions,
  collect,
  loadResolvedConfig,
  parsePositiveInt,
  requireCompareURLs,
  standardReporters,
  type ConfigFlags,
} from "../shared.js";

export interface TestFlags extends ConfigFlags {
  failOn: FailOn;
  /** false with --no-ai */
  ai?: boolean;
  ci?: boolean;
  json?: boolean;
  junit?: string;
  debug?: boolean;
  list?: boolean;
  /** Baseline mode: save this run's screenshots as the new baselines. */
  updateBaselines?: boolean;
  shard?: Shard;
  runGroup?: string;
}

export function addConfigOptions(command: Command): Command {
  command
    .option("-c, --config <path>", "config file path")
    .addOption(
      new Option("--browser <name>", "browser engine").choices(["chromium", "firefox", "webkit"]),
    )
    .option("--output-dir <path>", "run artifact directory")
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
  return addCheckOptions(command);
}

export function registerTestCommand(program: Command): void {
  const command = program
    .command("test")
    .description("capture production and staging, diff every route, and report the differences");
  addAIOptions(addConfigOptions(command))
    .addOption(
      new Option("--fail-on <level>", "what makes the exit code non-zero")
        .choices(FAIL_ON_VALUES as string[])
        .default("regression"),
    )
    .option("--ci", "no prompts, colours or spinners")
    .option("--json", "print the manifest JSON to stdout")
    .option("--junit <path>", "write a JUnit XML report")
    .option("--debug", "save Playwright traces")
    .option("--list", "print the resolved URL pairs and exit without capturing")
    .option("--run-group <id>", "shared identity for all shards of one execution")
    .option("--update-baselines", "baseline mode: save this run's screenshots as the baselines")
    .option(
      "--shard <i/n>",
      "run one part of the jobs, e.g. 1/4; combine the parts with `visualguard merge`",
      parseShard,
    )
    .action(async (flags: TestFlags) => {
      process.exitCode = await runTestCommand(flags);
    });
}

export async function runTestCommand(
  flags: TestFlags,
  reporters: Reporter[] = [],
): Promise<number> {
  const config = await loadResolvedConfig(flags);
  const baseline = config.mode === "baseline";
  if (baseline) {
    if (!config.baseURL.staging) {
      throw new ConfigError(
        "Baseline mode needs the site's URL in baseURL.staging (or --staging).",
      );
    }
    // Only the site is captured; production paths come from the same URL.
    config.baseURL.production ??= config.baseURL.staging;
  } else {
    if (flags.updateBaselines)
      throw new ConfigError('--update-baselines only applies when mode is "baseline".');
    requireCompareURLs(config);
  }

  if (flags.list) {
    await printJobList(config);
    return 0;
  }

  const allReporters: Reporter[] = [...standardReporters(config, flags), ...reporters];

  const { manifest } = await createRun(config, {
    ...(baseline
      ? {
          mode: "baseline" as const,
          baselineDir: resolve(config.cwd, config.baseline.dir),
          updateBaselines: flags.updateBaselines,
        }
      : {}),
    failOn: flags.failOn,
    debug: flags.debug,
    ai: flags.ai === false ? false : undefined,
    reporters: allReporters,
    shard: flags.shard,
    runGroup: flags.runGroup,
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
