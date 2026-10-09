/**
 * @file Canonical hashes, Git revision, capture-policy snapshots and baseline rendering
 * metadata/compatibility checks.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ResolvedConfig } from "../config/resolve.js";
import { ConfigError } from "./errors.js";
import type { JobSpec } from "./types.js";

/**
 * Serialize nested values with sorted object keys while preserving array order. Stable key
 * ordering makes equal policy objects hash identically regardless of property insertion order.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * Hash canonical serialized data with SHA-256. The resulting hexadecimal string identifies a
 * policy/request without storing the full value in every reference.
 */
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

/**
 * Read the current Git commit ID for provenance, returning undefined outside a usable Git
 * checkout. execFileSync passes arguments directly rather than constructing a shell command.
 */
export function sourceRevision(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Collect settings that affect capture/comparison for one route and viewport. This common
 * object is used to describe how an artifact was produced.
 */
export function capturePolicy(
  config: ResolvedConfig,
  job: Pick<JobSpec, "viewport" | "waitFor" | "mask" | "hide">,
) {
  return {
    browser: config.browser,
    viewport: config.viewports[job.viewport]!,
    stabilize: config.stabilize,
    screenshot: config.screenshot,
    checks: config.checks,
    diff: config.diff,
    waitFor: job.waitFor,
    mask: job.mask,
    hide: job.hide,
  };
}

export type CapturePolicy = ReturnType<typeof capturePolicy>;

/**
 * Build the baseline rendering identity from platform, project and capture policy, excluding
 * diff thresholds. Changing verdict thresholds does not change the rendered screenshot itself.
 */
export function renderingIdentity(
  config: ResolvedConfig,
  job: Pick<JobSpec, "viewport" | "waitFor" | "mask" | "hide">,
  project?: string,
) {
  const { diff: _diff, ...policy } = capturePolicy(config, job);
  return { platform: process.platform, project, policy };
}

/**
 * Write a baseline sidecar containing its identity, fingerprint, source revision and creation
 * time. A sidecar is a companion file beside the PNG rather than image pixel data.
 */
export function writeBaselineMetadata(path: string, identity: unknown, cwd: string): void {
  writeFileSync(
    path.replace(/\.png$/, ".meta.json"),
    `${JSON.stringify({ version: 1, fingerprint: fingerprint(identity), identity, sourceRevision: sourceRevision(cwd), createdAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/**
 * Check saved metadata against the requested rendering identity before using a baseline. Apply
 * the configured legacy policy to missing metadata and explain mismatches with a regeneration
 * hint.
 */
export function assertBaselineCompatible(
  path: string,
  identity: unknown,
  legacy: "error" | "allow",
): void {
  const metadata = path.replace(/\.png$/, ".meta.json");
  if (!existsSync(metadata)) {
    if (legacy === "allow") return;
    throw new ConfigError(`Baseline metadata missing for ${path}`, {
      hint: "Regenerate baselines with --update-baselines, or explicitly migrate with baseline.legacy: 'allow'.",
    });
  }
  let parsed: { version?: number; fingerprint?: string };
  try {
    parsed = JSON.parse(readFileSync(metadata, "utf8"));
  } catch {
    throw new ConfigError(`Invalid baseline metadata: ${metadata}`);
  }
  if (parsed.version !== 1 || parsed.fingerprint !== fingerprint(identity))
    throw new ConfigError(`Baseline rendering settings do not match: ${path}`, {
      hint: "Use the original browser/platform/viewport/theme settings or regenerate with --update-baselines.",
    });
}
