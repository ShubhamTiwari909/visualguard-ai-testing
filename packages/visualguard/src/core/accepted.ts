import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "./errors.js";
import type { JobResult } from "./types.js";

/**
 * Changes someone accepted as intentional (PLAN.md §5.4, `visualguard accept`). An entry matches
 * a job when both screenshots are byte-for-byte the ones that were accepted, so any further
 * change to either side is flagged again. The file is meant to be committed.
 */
export interface AcceptedEntry {
  job: string;
  route: string;
  viewport: string;
  /** sha256 of the production and staging screenshots. */
  hash: string;
  acceptedAt: string;
  note?: string;
  run?: string;
}

export interface AcceptedFile {
  version: 1;
  accepted: AcceptedEntry[];
}

export function readAccepted(path: string): AcceptedFile {
  if (!existsSync(path)) return { version: 1, accepted: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as AcceptedFile;
    if (!Array.isArray(parsed.accepted)) throw new Error("missing `accepted` array");
    return { version: 1, accepted: parsed.accepted };
  } catch (error) {
    throw new ConfigError(
      `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeAccepted(path: string, file: AcceptedFile): void {
  const sorted = [...file.accepted].sort(
    (a, b) => a.job.localeCompare(b.job) || a.acceptedAt.localeCompare(b.acceptedAt),
  );
  writeFileSync(path, `${JSON.stringify({ version: 1, accepted: sorted }, null, 2)}\n`);
}

/** Identifies the exact pair of screenshots a job compared. */
export function screenshotHash(job: JobResult, runDir: string): string | undefined {
  const production = job.captures.production?.image;
  const staging = job.captures.staging?.image;
  if (!production || !staging) return undefined;
  const hash = createHash("sha256");
  hash.update(readFileSync(join(runDir, production)));
  hash.update("\0");
  hash.update(readFileSync(join(runDir, staging)));
  return hash.digest("hex");
}

/** Marks the job accepted when an entry matches its screenshots. */
export function applyAccepted(job: JobResult, runDir: string, file: AcceptedFile): JobResult {
  if (job.status === "pass" || job.status === "error" || file.accepted.length === 0) return job;
  const candidates = file.accepted.filter((entry) => entry.job === job.id);
  if (candidates.length === 0) return job;
  const hash = screenshotHash(job, runDir);
  const entry = candidates.find((candidate) => candidate.hash === hash);
  if (!entry) return job;
  return {
    ...job,
    status: "accepted",
    acceptedBy: { hash: entry.hash, at: entry.acceptedAt, note: entry.note },
  };
}

/** Adds (or refreshes) entries for jobs, replacing older entries for the same job. */
export function acceptJobs(
  file: AcceptedFile,
  jobs: JobResult[],
  runDir: string,
  options: { note?: string; run?: string; now?: Date } = {},
): { file: AcceptedFile; added: AcceptedEntry[] } {
  const now = (options.now ?? new Date()).toISOString();
  const added: AcceptedEntry[] = [];
  for (const job of jobs) {
    const hash = screenshotHash(job, runDir);
    if (!hash) continue;
    added.push({
      job: job.id,
      route: job.route,
      viewport: job.viewport,
      hash,
      acceptedAt: now,
      note: options.note,
      run: options.run,
    });
  }
  const replaced = new Set(added.map((entry) => entry.job));
  return {
    file: {
      version: 1,
      accepted: [...file.accepted.filter((entry) => !replaced.has(entry.job)), ...added],
    },
    added,
  };
}
