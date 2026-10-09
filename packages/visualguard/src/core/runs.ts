/**
 * @file Creates numbered run directories, maintains the run index/retention, and reads/writes
 * manifests.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ConfigError } from "./errors.js";
import type { RunManifest, Status } from "./types.js";

export interface RunIndexEntry {
  id: string;
  number: number;
  startedAt: string;
  mode: RunManifest["mode"];
  summary: Record<Status, number>;
}

interface RunIndex {
  runs: RunIndexEntry[];
}

/**
 * Return the runs subdirectory beneath the configured output folder. Centralizing this path
 * keeps readers and writers on the same layout.
 */
export const runsDir = (outputDir: string) => join(outputDir, "runs");
/**
 * Return the run index JSON path. The index is separate from each run's full manifest and
 * supports finding recent runs.
 */
const indexPath = (outputDir: string) => join(runsDir(outputDir), "index.json");

/**
 * Read the saved run list, falling back to an empty list when the index is missing or unusable.
 * This allows a fresh output directory to work without setup files.
 */
export function readRunIndex(outputDir: string): RunIndex {
  const path = indexPath(outputDir);
  if (!existsSync(path)) return { runs: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RunIndex;
    return Array.isArray(parsed.runs) ? parsed : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

/**
 * Ensure the runs directory exists and write the index as readable JSON. The caller supplies
 * the complete list to persist.
 */
function writeRunIndex(outputDir: string, index: RunIndex): void {
  mkdirSync(runsDir(outputDir), { recursive: true });
  writeFileSync(indexPath(outputDir), `${JSON.stringify(index, null, 2)}\n`);
}

export interface NewRun {
  id: string;
  number: number;
  dir: string;
  startedAt: Date;
}

/**
 * Allocates the next run number and directory, e.g. runs/0042_2026-10-08T10-22-01Z.
 *
 * Allocate a run number/ID and create its jobs directory. Include a timestamp so artifacts have
 * a readable, distinct location.
 */
export function createRunDir(outputDir: string, env: NodeJS.ProcessEnv = process.env): NewRun {
  const index = readRunIndex(outputDir);
  const ciNumber = Number.parseInt(env.GITHUB_RUN_NUMBER ?? env.CI_PIPELINE_IID ?? "", 10);
  const last = index.runs.at(-1)?.number ?? 0;
  const number = Number.isFinite(ciNumber) && ciNumber > 0 ? ciNumber : last + 1;

  const startedAt = new Date();
  const stamp = startedAt
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
  let id = `${String(number).padStart(4, "0")}_${stamp}`;
  let dir = join(runsDir(outputDir), id);
  for (let suffix = 2; existsSync(dir); suffix++) {
    id = `${String(number).padStart(4, "0")}_${stamp}-${suffix}`;
    dir = join(runsDir(outputDir), id);
  }
  mkdirSync(join(dir, "jobs"), { recursive: true });
  return { id, number, dir, startedAt };
}

/**
 * Records a finished run in the index and deletes the oldest runs beyond `keepRuns`.
 *
 * Update the run index and remove old run directories beyond the retention limit. This function
 * changes disk state, so its keepRuns setting controls artifact cleanup.
 */
export function recordRun(outputDir: string, manifest: RunManifest, keepRuns: number): void {
  const index = readRunIndex(outputDir);
  index.runs = index.runs.filter((run) => run.id !== manifest.id);
  index.runs.push({
    id: manifest.id,
    number: manifest.number,
    startedAt: manifest.startedAt,
    mode: manifest.mode,
    summary: manifest.summary,
  });

  const excess = index.runs.length - keepRuns;
  if (excess > 0) {
    for (const old of index.runs.splice(0, excess)) {
      const dir = resolve(runsDir(outputDir), old.id);
      // Only ever delete directories inside runs/.
      if (dir.startsWith(resolve(runsDir(outputDir)) + sep))
        rmSync(dir, { recursive: true, force: true });
    }
  }
  writeRunIndex(outputDir, index);
}

/**
 * Finds a run directory by id (or unique id prefix / run number); defaults to the latest.
 *
 * Find the latest run or match an ID, unique prefix or run number. Throw a useful configuration
 * error when there is no unambiguous saved run.
 */
export function findRun(outputDir: string, id?: string): { entry: RunIndexEntry; dir: string } {
  const index = readRunIndex(outputDir);
  if (index.runs.length === 0) {
    throw new ConfigError(`No runs found in ${relative(process.cwd(), outputDir) || outputDir}`, {
      hint: "Run `npx visualguard test` first.",
    });
  }
  let entry: RunIndexEntry | undefined;
  if (!id) {
    entry = index.runs.at(-1);
  } else {
    const matches = index.runs.filter(
      (run) =>
        run.id === id || run.id.startsWith(id) || String(run.number) === id.replace(/^#/, ""),
    );
    if (matches.length > 1) {
      throw new ConfigError(`Run "${id}" is ambiguous: ${matches.map((run) => run.id).join(", ")}`);
    }
    entry = matches[0];
  }
  if (!entry) throw new ConfigError(`Run "${id}" not found`);
  return { entry, dir: join(runsDir(outputDir), entry.id) };
}

/**
 * Read the complete manifest JSON for a run, requiring the file to exist. The TypeScript
 * assertion describes its expected shape; it is not runtime schema validation.
 */
export function readManifest(runDir: string): RunManifest {
  const path = join(runDir, "manifest.json");
  if (!existsSync(path)) throw new ConfigError(`No manifest.json in ${runDir}`);
  return JSON.parse(readFileSync(path, "utf8")) as RunManifest;
}

/**
 * Persist the current run manifest as formatted JSON with a final newline. Saved reports and
 * subsequent CLI commands read this file.
 */
export function writeManifest(runDir: string, manifest: RunManifest): void {
  writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
