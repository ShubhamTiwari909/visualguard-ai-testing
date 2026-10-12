/**
 * @file Discovers shard manifests, validates shared identity/full coverage and copies artifacts
 * into one merged run.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ResolvedConfig } from "../config/resolve.js";
import { ConfigError } from "./errors.js";
import type { Reporter } from "./run.js";
import { createRunDir, readManifest, recordRun, runsDir, writeManifest } from "./runs.js";
import { summarize } from "./status.js";
import type { JobResult, RunManifest } from "./types.js";

/**
 * Finds run directories under `path`: a run directory itself, an output or runs directory (its
 * latest run, plus the latest run of every other shard when that run is a shard), or a folder
 * of downloaded CI artifacts holding any of those, a few levels deep.
 *
 * Find saved run directories directly or beneath downloaded artifact/output folders. Bound
 * recursive depth and skip irrelevant directories so discovery does not scan an entire
 * filesystem.
 */
export function findRunDirs(path: string, depth = 4): string[] {
  const dir = resolve(path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new ConfigError(`${path} is not a directory`);
  }
  if (existsSync(join(dir, "manifest.json"))) return [dir];
  for (const runs of [runsDir(dir), dir]) {
    if (existsSync(join(runs, "index.json"))) return latestRuns(runs);
  }
  if (depth === 0) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .flatMap((entry) => findRunDirs(join(dir, entry.name), depth - 1));
}

/**
 * Select the newest applicable run for each shard, excluding prior merge outputs. Sort shard
 * indexes so the selected inputs have a predictable order.
 */
function latestRuns(runs: string): string[] {
  // Newest first; earlier merge results are outputs, never inputs.
  const candidates = readdirSync(runs)
    .filter((name) => existsSync(join(runs, name, "manifest.json")))
    .sort()
    .reverse()
    .map((name) => ({ dir: join(runs, name), manifest: readManifest(join(runs, name)) }))
    .filter(({ manifest }) => !manifest.mergedFrom);
  const latest = candidates[0];
  if (!latest) return [];
  const shard = latest.manifest.shard;
  if (!shard) return [latest.dir];
  // Shards run into the same folder (on one machine): take the newest run of each shard.
  const picked = new Map<number, string>();
  for (const { dir, manifest } of candidates) {
    const other = manifest.shard;
    if (
      other?.total === shard.total &&
      manifest.provenance?.group === latest.manifest.provenance?.group &&
      !picked.has(other.index)
    )
      picked.set(other.index, dir);
  }
  return [...picked.entries()].sort(([a], [b]) => a - b).map(([, dir]) => dir);
}

export interface MergeOptions {
  reporters?: Reporter[];
  env?: NodeJS.ProcessEnv;
  allowPartial?: boolean;
}

/**
 * Combines shard runs (`visualguard test --shard i/n` on several machines) into one run with
 * one report, summary and exit code (`visualguard merge`).
 *
 * Validate shard membership and configuration, combine jobs/artifacts and write one
 * manifest/report. Mark allowed partial merges incomplete so missing shard evidence cannot
 * create a false pass.
 */
export async function mergeRuns(
  config: ResolvedConfig,
  paths: readonly string[],
  options: MergeOptions = {},
): Promise<{ manifest: RunManifest; runDir: string }> {
  const sources = [...new Set(paths.flatMap((path) => findRunDirs(path)))];
  if (sources.length === 0) {
    throw new ConfigError(`No runs found in ${paths.join(", ")}`, {
      hint: "Pass the run directories (or .visualguard folders) each shard uploaded.",
    });
  }
  const manifests = sources.map((dir) => ({ dir, manifest: readManifest(dir) }));
  const modes = new Set(manifests.map(({ manifest }) => manifest.mode));
  if (modes.size > 1) {
    throw new ConfigError(`Can't merge runs of different modes: ${[...modes].join(", ")}`);
  }

  const firstInput = manifests[0]!.manifest;
  const identity = firstInput.provenance;
  if (!identity)
    throw new ConfigError("Cannot merge legacy runs without provenance; rerun the shards.");
  for (const { manifest } of manifests) {
    if (
      !manifest.shard ||
      !manifest.provenance ||
      manifest.provenance.group !== identity.group ||
      manifest.provenance.fingerprint !== identity.fingerprint ||
      manifest.provenance.sourceRevision !== identity.sourceRevision ||
      JSON.stringify(manifest.provenance.expectedJobs) !== JSON.stringify(identity.expectedJobs) ||
      manifest.shard.total !== firstInput.shard?.total
    )
      throw new ConfigError(
        "Cannot merge incompatible runs (group, revision, configuration or shard count differs).",
      );
  }
  const indices = manifests.map(({ manifest }) => manifest.shard!.index);
  if (new Set(indices).size !== indices.length)
    throw new ConfigError("Duplicate shard indices in merge inputs.");
  const ids = manifests.flatMap(({ manifest }) => manifest.jobs.map((j) => j.id));
  if (new Set(ids).size !== ids.length) throw new ConfigError("Duplicate job IDs in merge inputs.");
  if (ids.some((id) => !identity.expectedJobs.includes(id)))
    throw new ConfigError("Unexpected jobs in shard inputs.");
  const incomplete =
    indices.length !== firstInput.shard!.total ||
    identity.expectedJobs.some((id) => !ids.includes(id));
  if (incomplete && !options.allowPartial)
    throw new ConfigError(
      "Incomplete shard set or missing jobs; pass --allow-partial to produce an explicitly incomplete report.",
    );

  const run = createRunDir(config.outputDir, options.env);
  const jobs: JobResult[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const { dir, manifest } of manifests) {
    for (const job of manifest.jobs) {
      if (seen.has(job.id)) {
        warnings.push(`${job.id} is in more than one shard; kept the first`);
        continue;
      }
      seen.add(job.id);
      const jobDir = join(dir, "jobs", job.id);
      if (existsSync(jobDir)) cpSync(jobDir, join(run.dir, "jobs", job.id), { recursive: true });
      jobs.push(job);
    }
  }

  const first = manifests[0]!.manifest;
  /**
   * Add one chosen usage counter across input manifests, using zero for missing counters. The
   * pick callback lets the same reducer total input tokens, output tokens or attempts.
   */
  const sum = (pick: (usage: NonNullable<RunManifest["usage"]>) => number | undefined) =>
    manifests.reduce(
      (total, { manifest }) => total + (manifest.usage ? (pick(manifest.usage) ?? 0) : 0),
      0,
    );
  const startedAt = manifests.map(({ manifest }) => manifest.startedAt).sort()[0]!;
  const manifest: RunManifest = {
    ...first,
    id: run.id,
    number: run.number,
    startedAt,
    durationMs: Math.max(...manifests.map(({ manifest }) => manifest.durationMs)),
    shard: undefined,
    incomplete: incomplete || undefined,
    mergedFrom: manifests.map(({ manifest }) => manifest.id),
    summary: summarize(jobs),
    usage: manifests.some(({ manifest }) => manifest.usage)
      ? {
          generationAttempts: sum((u) => u.generationAttempts),
          networkAttempts: sum((u) => u.networkAttempts),
          aiCalls: sum((usage) => usage.aiCalls),
          inputTokens: sum((usage) => usage.inputTokens),
          outputTokens: sum((usage) => usage.outputTokens),
          thinkingTokens: sum((usage) => usage.thinkingTokens) || undefined,
        }
      : undefined,
    jobs: jobs.sort(
      (a, b) => a.route.localeCompare(b.route) || a.viewport.localeCompare(b.viewport),
    ),
  };

  writeManifest(run.dir, manifest);
  recordRun(config.outputDir, manifest, config.output.keepRuns);

  // Replay the run through the reporters, so the terminal summary, HTML report, JUnit file, job
  // summary and webhook all describe the merged run.
  const reporters = options.reporters ?? [];
  /**
   * Notify merge reporters about progress while isolating their event-handler errors. Optional
   * chaining calls onEvent only when a reporter implements it.
   */
  const emit = (event: Parameters<NonNullable<Reporter["onEvent"]>>[0]) => {
    for (const reporter of reporters) {
      try {
        reporter.onEvent?.(event);
      } catch {
        // Reporters must not break the merge.
      }
    }
  };
  emit({
    type: "run:start",
    runId: run.id,
    number: run.number,
    runDir: run.dir,
    jobs: manifest.jobs.map((job) => ({
      id: job.id,
      route: job.route,
      name: job.name,
      viewport: job.viewport,
      urls: job.urls,
      mask: [],
      hide: [],
    })),
    baseURL: first.config.baseURL,
    viewports: first.config.viewports,
    routeCount: new Set(manifest.jobs.map((job) => job.route)).size,
    warnings: [
      `Merged ${manifests.length} run${manifests.length > 1 ? "s" : ""} from ${sources.map((dir) => relative(process.cwd(), dir) || ".").join(", ")}`,
      ...warnings,
    ],
    ai: first.config.ai.model
      ? { provider: first.config.ai.provider, model: first.config.ai.model }
      : undefined,
    mergedShards: manifests.length,
  });
  for (const job of manifest.jobs) emit({ type: "job:end", job });
  emit({ type: "run:end", manifest, runDir: run.dir });
  for (const reporter of reporters) {
    await reporter.onRunEnd?.(manifest, { runDir: run.dir, config });
  }
  return { manifest, runDir: run.dir };
}
