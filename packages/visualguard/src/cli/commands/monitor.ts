import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Option, type Command } from "commander";
import pc from "picocolors";
import { normalizeBaseURL } from "../../config/urls.js";
import { ConfigError } from "../../core/errors.js";
import { createRun } from "../../core/run.js";
import { exitCodeFor, FAIL_ON_VALUES } from "../../core/status.js";
import type { FailOn, RunManifest } from "../../core/types.js";
import { detectPackageManager } from "../../setup/project.js";
import { renderMonitorWorkflow } from "../../setup/workflow-template.js";
import {
  addAIOptions,
  loadResolvedConfig,
  standardReporters,
  type ConfigFlags,
} from "../shared.js";
import { addConfigOptions } from "./test.js";

export interface MonitorFlags extends ConfigFlags {
  failOn: FailOn;
  ai?: boolean;
  ci?: boolean;
  json?: boolean;
  junit?: string;
  debug?: boolean;
  /** Replace every stored snapshot with this run's captures. */
  reset?: boolean;
  /** Write a scheduled GitHub Actions workflow instead of running. */
  workflow?: boolean | string;
}

export function registerMonitorCommand(program: Command): void {
  const command = program
    .command("monitor")
    .description(
      "compare the live site with its own previous capture, e.g. nightly, to catch CMS edits and broken third-party scripts",
    )
    .argument("[url]", "site to monitor (default: baseURL.production)");
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
    .option("--reset", "replace every stored snapshot with this run's captures")
    .option(
      "--workflow [schedule]",
      'write .github/workflows/visualguard-monitor.yml (cron, default "0 3 * * *") and exit',
    )
    .action(async (url: string | undefined, flags: MonitorFlags) => {
      process.exitCode = await runMonitorCommand(url, flags);
    });
}

export async function runMonitorCommand(
  url: string | undefined,
  flags: MonitorFlags,
): Promise<number> {
  if (flags.workflow) return writeMonitorWorkflow(flags.workflow, url);

  const config = await loadResolvedConfig({ ...flags, production: url ?? flags.production });
  const site = config.baseURL.production ?? config.baseURL.staging;
  if (!site) {
    throw new ConfigError("Nothing to monitor: pass a URL or set baseURL.production.", {
      hint: "npx visualguard monitor https://example.com",
    });
  }
  // The live site is the "current" side; the previous capture is the reference.
  config.baseURL = { production: site, staging: site };
  const host = normalizeBaseURL(site).host.replace(/[^a-z0-9.-]+/gi, "_");
  const snapshotDir = resolve(config.cwd, config.monitor.dir, host);

  const reporters = standardReporters(config, flags, (manifest) =>
    nextSteps(manifest, snapshotDir),
  );
  const { manifest } = await createRun(config, {
    mode: "monitor",
    baselineDir: snapshotDir,
    updateBaselines: flags.reset || config.monitor.update === "always" ? true : "unless-regression",
    baselineHealth: true,
    failOn: flags.failOn,
    debug: flags.debug,
    ai: flags.ai === false ? false : undefined,
    reporters,
  }).start();
  return exitCodeFor(manifest, flags.failOn);
}

function nextSteps(manifest: RunManifest, snapshotDir: string): Array<[string, string]> {
  const compared = manifest.jobs.some((job) => job.captures.production?.source === "baseline");
  const kept = manifest.jobs.filter((job) => job.status === "regression").length;
  const where = relative(process.cwd(), snapshotDir) || snapshotDir;
  return [
    [
      "Snapshots",
      !compared
        ? `saved to ${where}; the next run compares against them`
        : kept > 0
          ? `updated, except ${kept} regressed page${kept > 1 ? "s" : ""} (reported again until fixed; --reset accepts them)`
          : `updated in ${where}`,
    ],
  ];
}

async function writeMonitorWorkflow(
  schedule: string | true,
  url: string | undefined,
): Promise<number> {
  const cwd = process.cwd();
  const path = join(cwd, ".github", "workflows", "visualguard-monitor.yml");
  if (existsSync(path)) {
    throw new ConfigError(`${relative(cwd, path)} already exists`, {
      hint: "Delete it first to write a fresh one.",
    });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    renderMonitorWorkflow(detectPackageManager(cwd), {
      schedule: schedule === true ? "0 3 * * *" : schedule,
      url,
    }),
  );
  process.stdout.write(
    `${pc.green("✔")} Wrote ${relative(cwd, path)}\n  Add repository secrets GEMINI_API_KEY (optional) and VISUALGUARD_WEBHOOK_URL (Slack, n8n…) to get notified.\n`,
  );
  return 0;
}
