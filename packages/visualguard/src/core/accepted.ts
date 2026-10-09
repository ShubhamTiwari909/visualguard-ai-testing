/**
 * @file Reads/writes accepted changes, hashes screenshots and compares exact/similar change
 * fingerprints with health guards.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "./errors.js";
import type { Box, Delta, JobResult } from "./types.js";

/**
 * Changes someone accepted as intentional (PLAN.md §5.4, `visualguard accept`). An entry
 * matches a job when both screenshots are byte-for-byte the ones that were accepted, or (with
 * `output.acceptMatch: "similar"`) when the job shows the same change: the same DOM changes in
 * the same places. Anything else is flagged again. The file is meant to be committed.
 */
export interface AcceptedEntry {
  job: string;
  route: string;
  viewport: string;
  /**
   * sha256 of the production and staging screenshots.
   */
  hash: string;
  /**
   * What changed, for matching re-renders that differ by a few pixels.
   */
  change?: ChangeFingerprint;
  acceptedAt: string;
  note?: string;
  run?: string;
}

export type AcceptMatch = "exact" | "similar";

/**
 * The shape of a job's difference, independent of the exact pixels.
 */
export interface ChangeFingerprint {
  size: { width: number; height: number };
  shift?: { fromY: number; deltaY: number };
  regions: Array<{ box: Box; diffPixels: number }>;
  /**
   * DOM changes, one line each, sorted.
   */
  deltas: string[];
}

/**
 * Serialize one DOM difference into stable fingerprint text. Include its selector and old/new
 * values so accepting one change does not accept every change on that element.
 */
function formatDelta(delta: Delta): string {
  switch (delta.kind) {
    case "style":
      return `style ${delta.selector} ${delta.property}: ${delta.production} → ${delta.staging}`;
    case "text":
      return `text ${delta.selector}: ${delta.production} → ${delta.staging}`;
    case "box": {
      /**
       * Round a bounding box and serialize x, y, width and height in a fixed order. Small
       * subpixel layout variations then do not change this text representation.
       */
      const box = (b: Box) =>
        [b.x, b.y, b.width, b.height].map((value) => Math.round(value)).join(",");
      return `box ${delta.selector}: ${box(delta.production)} → ${box(delta.staging)}`;
    }
    case "presence":
      return `presence ${delta.selector}: only in ${delta.presentIn}`;
  }
}

/**
 * Summarize image dimensions, layout shift, changed regions and deduplicated DOM deltas. Return
 * undefined when there is no diff evidence to fingerprint.
 */
export function changeFingerprint(job: JobResult): ChangeFingerprint | undefined {
  if (!job.diff) return undefined;
  return {
    size: { width: job.diff.width, height: job.diff.height },
    shift: job.diff.shift,
    regions: job.regions.map((region) => ({ box: region.box, diffPixels: region.diffPixels })),
    deltas: [...new Set(job.regions.flatMap((region) => region.deltas.map(formatDelta)))].sort(),
  };
}

/**
 * Calculate intersection-over-union for two rectangles. The result is zero for no overlap and
 * approaches one when the rectangles cover the same area.
 */
function overlap(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

/**
 * Compare two numeric values within an absolute tolerance. Math.abs makes the check symmetric
 * regardless of which value is larger.
 */
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

/**
 * True when two fingerprints describe the same change: identical DOM changes, the same layout
 * shift, and regions in the same places (overlap ≥ 70%) with a similar number of differing
 * pixels (±35%). Anti-aliasing and sub-pixel noise pass; a new or moved difference doesn't.
 *
 * Compare accepted/current fingerprints using geometry and pixel-count tolerances plus DOM
 * evidence. This permits small rendering noise while rejecting materially new or relocated
 * changes.
 */
export function sameChange(accepted: ChangeFingerprint, current: ChangeFingerprint): boolean {
  if (accepted.size.width !== current.size.width) return false;
  if (!near(accepted.size.height, current.size.height, Math.max(4, accepted.size.height * 0.01)))
    return false;
  if (Boolean(accepted.shift) !== Boolean(current.shift)) return false;
  if (
    accepted.shift &&
    current.shift &&
    (accepted.shift.deltaY !== current.shift.deltaY ||
      !near(accepted.shift.fromY, current.shift.fromY, 8))
  )
    return false;
  if (accepted.deltas.length !== current.deltas.length) return false;
  if (accepted.deltas.some((delta, index) => delta !== current.deltas[index])) return false;
  if (accepted.regions.length !== current.regions.length) return false;

  const unmatched = [...accepted.regions];
  for (const region of current.regions) {
    let best = -1;
    let bestOverlap = 0.7;
    unmatched.forEach((candidate, index) => {
      const score = overlap(candidate.box, region.box);
      if (score >= bestOverlap) {
        best = index;
        bestOverlap = score;
      }
    });
    if (best < 0) return false;
    const [match] = unmatched.splice(best, 1);
    const ratio = region.diffPixels / Math.max(1, match!.diffPixels);
    if (ratio < 1 / 1.35 || ratio > 1.35) return false;
  }
  return true;
}

export interface AcceptedFile {
  version: 1;
  accepted: AcceptedEntry[];
}

/**
 * Read the versioned acceptance file, returning an empty file when it does not exist. Malformed
 * contents become a configuration error instead of silently accepting or ignoring changes.
 */
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

/**
 * Sort acceptance entries and write readable JSON with a final newline. Stable ordering keeps
 * review diffs predictable when developers commit the acceptance file.
 */
export function writeAccepted(path: string, file: AcceptedFile): void {
  const sorted = [...file.accepted].sort(
    (a, b) => a.job.localeCompare(b.job) || a.acceptedAt.localeCompare(b.acceptedAt),
  );
  writeFileSync(path, `${JSON.stringify({ version: 1, accepted: sorted }, null, 2)}\n`);
}

/**
 * Identifies the exact pair of screenshots a job compared.
 *
 * Hash the exact production and staging PNG bytes for a job. Return no hash when either capture
 * is missing, because there is no complete image pair to accept.
 */
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

/**
 * Marks the job accepted when an entry matches its screenshots, or with `match: "similar"` its
 * change. A similar match never hides a new health problem (broken image, HTTP error…).
 *
 * Return an accepted job when an entry matches its exact screenshots or permitted
 * similar-change fingerprint. Preserve new health failures and leave passing/error jobs
 * unchanged.
 */
export function applyAccepted(
  job: JobResult,
  runDir: string,
  file: AcceptedFile,
  match: AcceptMatch = "similar",
): JobResult {
  if (job.status === "pass" || job.status === "error" || file.accepted.length === 0) return job;
  // Acceptance covers visual changes, never independent health/check failures.
  if (job.findings?.some((finding) => finding.source === "health" && finding.severity !== "info"))
    return job;
  const candidates = file.accepted.filter((entry) => entry.job === job.id);
  if (candidates.length === 0) return job;
  const hash = screenshotHash(job, runDir);
  let entry = candidates.find((candidate) => candidate.hash === hash);
  let how: AcceptMatch = "exact";
  if (!entry && match === "similar") {
    const healthy = !(job.findings ?? []).some(
      (finding) => finding.source === "health" && finding.severity === "regression",
    );
    const change = changeFingerprint(job);
    entry =
      healthy && change
        ? candidates.find((candidate) => candidate.change && sameChange(candidate.change, change))
        : undefined;
    how = "similar";
  }
  if (!entry) return job;
  return {
    ...job,
    status: "accepted",
    acceptedBy: { hash: entry.hash, at: entry.acceptedAt, note: entry.note, match: how },
  };
}

/**
 * Adds (or refreshes) entries for jobs, replacing older entries for the same job.
 *
 * Create timestamped acceptance entries for selected jobs and replace older entries for the
 * same job IDs. Return the updated file and added entries without writing them yet.
 */
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
      change: changeFingerprint(job),
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
