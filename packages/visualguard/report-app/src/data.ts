/**
 * @file Browser report data contracts, injected-data access, formatting/sorting and URL hash
 * state; imports shared types only.
 *
 * This module runs in the report viewer's browser. React components return JSX (the markup-like
 * syntax); state changes request a new render, while effects synchronize browser APIs and clean
 * up listeners.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Env, JobResult, RunManifest, Status } from "../../src/core/types";

export type { Env, JobResult, RunManifest, Status };

export interface ReportData {
  manifest: RunManifest;
  generatedAt: string;
}

export interface ServerInfo {
  token: string;
  /**
   * fix.enabled: show "Generate fix".
   */
  fixEnabled?: boolean;
}

declare global {
  interface Window {
    __VISUALGUARD__?: ReportData;
    __VISUALGUARD_SERVER__?: ServerInfo;
  }
}

/**
 * Read the data embedded in the generated HTML report. The report is self-contained, so opening
 * it does not require fetching its manifest from a remote API.
 */
export function loadReportData(): ReportData | undefined {
  return window.__VISUALGUARD__;
}

/**
 * Read optional local-server connection details from the page. An absent value means the HTML
 * report is being viewed without interactive server actions.
 */
export function serverInfo(): ServerInfo | undefined {
  return window.__VISUALGUARD_SERVER__;
}

export const STATUS_ORDER: Status[] = ["error", "regression", "review", "accepted", "pass"];

export const STATUS_LABEL: Record<Status, string> = {
  pass: "Pass",
  accepted: "Accepted",
  review: "Review",
  regression: "Regression",
  error: "Error",
};

/**
 * Return jobs in the report's preferred status/route order. Sorting a copied array keeps the
 * original manifest order intact.
 */
export function sortJobs(jobs: JobResult[]): JobResult[] {
  return [...jobs].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      a.route.localeCompare(b.route) ||
      a.viewport.localeCompare(b.viewport),
  );
}

/**
 * Labels for the two sides: production/staging, baseline/current in scan and baseline modes,
 * and previous/current in monitor mode.
 *
 * Choose human-readable names for the two captures. Compare runs use production/staging, while
 * baseline runs use baseline/current.
 */
export function envLabels(manifest: RunManifest): Record<Env, string> {
  if (manifest.mode === "compare") return { production: "Production", staging: "Staging" };
  if (manifest.mode === "monitor") return { production: "Previous", staging: "Current" };
  return { production: "Baseline", staging: "Current" };
}

/**
 * The canvas both screenshots are compared on (the larger of the two).
 *
 * Find dimensions that can contain both job screenshots. A common canvas keeps overlays aligned
 * even when one page is taller than the other.
 */
export function canvasSize(job: JobResult): { width: number; height: number } | undefined {
  if (job.diff) return { width: job.diff.width, height: job.diff.height };
  const sizes = [job.captures.production?.size, job.captures.staging?.size].filter(
    (size): size is { width: number; height: number } => Boolean(size),
  );
  if (sizes.length === 0) return undefined;
  return {
    width: Math.max(...sizes.map((size) => size.width)),
    height: Math.max(...sizes.map((size) => size.height)),
  };
}

/**
 * Convert a fraction into a percentage string for display. A fraction of 0.01 represents one
 * percent, so the formatter multiplies by 100.
 */
export function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  if (percent === 0) return "0%";
  if (percent < 0.01) return "<0.01%";
  return `${percent.toFixed(2)}%`;
}

/**
 * Convert milliseconds into readable elapsed-time text. Formatting affects only the label;
 * stored run durations remain numeric.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/**
 * One-line summary of why a job has its status.
 *
 * Choose a short description of the job's result for the list. Prefer available explanation
 * text and fall back to the measured comparison.
 */
export function jobSummary(job: JobResult): string {
  if (job.error) return `${job.error.stage} failed`;
  if (job.status === "accepted") return "Matches an accepted change";
  if (job.analysis) return job.analysis.title;
  const finding =
    job.findings?.find((item) => item.severity === job.status) ??
    job.findings?.find((item) => item.severity !== "info") ??
    job.findings?.find((item) => item.source === "heuristic");
  if (finding) return finding.message;
  if (!job.diff) return job.captures.production ? "" : "New snapshot";
  if (job.diff.diffPixels === 0) return "Identical";
  if (job.status === "pass") return `${job.diff.diffPixels}px within tolerance`;
  return `${formatPercent(job.diff.diffRatio)} changed · ${job.regions.length} region${job.regions.length === 1 ? "" : "s"}`;
}

export interface HashState {
  jobId?: string;
  view?: string;
}

/**
 * Decode selection and view state from the URL fragment after #. This fragment stays in the
 * browser and enables links to a specific job.
 */
export function readHash(): HashState {
  const match = window.location.hash.match(/^#\/jobs\/([^?]+)(?:\?(.*))?$/);
  if (!match) return {};
  const params = new URLSearchParams(match[2] ?? "");
  return { jobId: decodeURIComponent(match[1]!), view: params.get("view") ?? undefined };
}

/**
 * Update the URL fragment to match the selected job and view. Replacing browser history avoids
 * creating a new history entry for every UI change.
 */
export function writeHash(state: HashState): void {
  if (!state.jobId) return;
  const query = state.view ? `?view=${state.view}` : "";
  const hash = `#/jobs/${encodeURIComponent(state.jobId)}${query}`;
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
}
