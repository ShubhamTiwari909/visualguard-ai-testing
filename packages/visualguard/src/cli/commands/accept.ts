import { relative } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import type { ResolvedConfig } from "../../config/resolve.js";
import { matchesAny } from "../../config/glob.js";
import {
  acceptJobs,
  applyAccepted,
  readAccepted,
  writeAccepted,
  type AcceptedEntry,
} from "../../core/accepted.js";
import { ConfigError } from "../../core/errors.js";
import { findRun, readManifest, recordRun, writeManifest } from "../../core/runs.js";
import { summarize } from "../../core/status.js";
import type { JobResult, RunManifest } from "../../core/types.js";
import { pluralize } from "../../core/util.js";
import { writeReport } from "../../reporters/html.js";
import { collect, loadResolvedConfig } from "../shared.js";

export interface AcceptFlags {
  config?: string;
  run?: string;
  viewport?: string[];
  all?: boolean;
  note?: string;
}

export interface AcceptOptions {
  runId?: string;
  /** Route paths or globs; empty with `all` accepts every job that needs review. */
  routes?: string[];
  jobIds?: string[];
  viewports?: string[];
  all?: boolean;
  note?: string;
}

export interface AcceptResult {
  added: AcceptedEntry[];
  manifest: RunManifest;
  path: string;
}

/**
 * Accepts the changes in a run as intentional (PLAN.md §12, `visualguard accept`): records the
 * exact screenshots in visualguard.accepted.json and marks the jobs accepted in that run.
 * `--all` only takes jobs marked review; regressions must be named explicitly.
 */
export function acceptChanges(config: ResolvedConfig, options: AcceptOptions): AcceptResult {
  const { entry, dir } = findRun(config.outputDir, options.runId);
  const manifest = readManifest(dir);
  const differs = (job: JobResult) =>
    ["review", "regression"].includes(job.status) &&
    job.captures.production &&
    job.captures.staging;

  let selected: JobResult[];
  if (options.jobIds?.length) {
    selected = manifest.jobs.filter((job) => options.jobIds!.includes(job.id) && differs(job));
  } else if (options.routes?.length) {
    selected = manifest.jobs.filter(
      (job) => matchesAny(job.route, options.routes!) && differs(job),
    );
  } else if (options.all) {
    selected = manifest.jobs.filter((job) => job.status === "review" && differs(job));
  } else {
    throw new ConfigError(
      "Name the routes to accept, or pass --all to accept every change marked review.",
    );
  }
  if (options.viewports?.length)
    selected = selected.filter((job) => options.viewports!.includes(job.viewport));
  if (selected.length === 0) {
    throw new ConfigError(`Nothing to accept in run #${entry.number}`, {
      hint: "Only jobs with status review or regression and two screenshots can be accepted.",
    });
  }

  const { file, added } = acceptJobs(readAccepted(config.acceptedPath), selected, dir, {
    note: options.note,
    run: manifest.id,
  });
  writeAccepted(config.acceptedPath, file);

  const acceptedIds = new Set(added.map((item) => item.job));
  const jobs = manifest.jobs.map((job) =>
    acceptedIds.has(job.id) ? applyAccepted(job, dir, file, "exact") : job,
  );
  const updated: RunManifest = { ...manifest, jobs, summary: summarize(jobs) };
  writeManifest(dir, updated);
  recordRun(config.outputDir, updated, config.output.keepRuns);
  if (config.report.html) writeReport(dir, updated);
  return { added, manifest: updated, path: config.acceptedPath };
}

export function registerAcceptCommand(program: Command): void {
  program
    .command("accept")
    .description(
      "accept changes as intentional so they stop failing (writes visualguard.accepted.json)",
    )
    .argument("[routes...]", "routes or globs to accept, e.g. /pricing or '/blog/**'")
    .option("-c, --config <path>", "config file path")
    .option("--run <id>", "run id, id prefix or run number (default: latest)")
    .option("--viewport <name>", "only this viewport; repeatable", collect)
    .option("--all", "accept every change marked review in the run")
    .option("--note <text>", "why the change is intentional")
    .action(async (routes: string[], flags: AcceptFlags) => {
      const config = await loadResolvedConfig({ config: flags.config });
      const result = acceptChanges(config, {
        runId: flags.run,
        routes,
        viewports: flags.viewport,
        all: flags.all,
        note: flags.note,
      });
      const write = (line = "") => process.stdout.write(`${line}\n`);
      write();
      for (const item of result.added)
        write(`  ${pc.green("✓")}  ${item.route}  ${pc.dim(item.viewport)}`);
      write();
      write(
        `  Accepted ${pluralize(result.added.length, "change")} in ${relative(process.cwd(), result.path) || result.path}. Commit this file; matching screenshots will pass from now on.`,
      );
      write();
    });
}
