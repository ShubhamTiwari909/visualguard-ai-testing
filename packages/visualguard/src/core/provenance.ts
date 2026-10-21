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
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ResolvedConfig } from "../config/resolve.js";
import { screenshotSelector } from "../config/screenshot.js";
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
  job: Pick<JobSpec, "viewport" | "waitFor" | "mask" | "hide" | "screenshotSelector">,
) {
  const { selector: _globalSelector, ...screenshot } = config.screenshot;
  const selector = screenshotSelector(config, job);
  return {
    browser: config.browser,
    viewport: config.viewports[job.viewport]!,
    stabilize: config.stabilize,
    screenshot: { ...screenshot, ...(selector ? { selector } : {}) },
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
 * the entire diff configuration (engine, thresholds, region and noise-map settings). These
 * comparison settings do not change the rendered screenshot itself.
 */
export function renderingIdentity(
  config: ResolvedConfig,
  job: Pick<JobSpec, "viewport" | "waitFor" | "mask" | "hide" | "screenshotSelector">,
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

/** Approved snapshots are immutable locally; advance them with another explicit pull. */
function approvedReceiptPath(path: string): string | undefined {
  const directory = dirname(path);
  const own = join(directory, "approved-baseline.json");
  if (existsSync(own)) return own;
  const parent = join(dirname(directory), "approved-baseline.json");
  return basename(directory) === "playwright" && existsSync(parent) ? parent : undefined;
}
const approvedReceipt = (path: string) => Boolean(approvedReceiptPath(path));
export function assertApprovedBaselinePresent(path: string): void {
  if (
    approvedReceipt(path) &&
    (!existsSync(path) || !existsSync(path.replace(/\.png$/, ".meta.json")))
  )
    throw new ConfigError(`Check is missing from the pinned approved snapshot: ${path}`, {
      hint: "Pull a compatible approved set, or explicitly change its coverage through promotion.",
    });
}
export function assertBaselineWritable(path: string): void {
  if (approvedReceipt(path))
    throw new ConfigError("Approved snapshots cannot be updated locally", {
      hint: "Pull another approved version into a new directory.",
    });
  const metadata = path.replace(/\.png$/, ".meta.json");
  if (!existsSync(metadata)) return;
  let parsed: { approvedReference?: unknown };
  try {
    parsed = JSON.parse(readFileSync(metadata, "utf8"));
  } catch {
    return;
  } // Ordinary local baselines keep their explicit migration workflow.
  if (parsed.approvedReference)
    throw new ConfigError("Approved baselines cannot be updated locally", {
      hint: "Pull another approved version into a new directory, or use a separate local baseline directory.",
    });
}

/** Verify the approved image and companion evidence before recording selection provenance. */
export function approvedBaselineReference(
  path: string,
  check?: { jobId: string; route: string; viewport: string; identity: unknown },
): import("../../../../apps/platform/shared/baselines.js").BaselineReference | undefined {
  const metadata = path.replace(/\.png$/, ".meta.json");
  if (!existsSync(metadata)) return;
  let parsed: {
    approvedReference?: import("../../../../apps/platform/shared/baselines.js").BaselineReference;
    approvedArtifacts?: { image?: string; dom?: string; health?: string };
  };
  try {
    parsed = JSON.parse(readFileSync(metadata, "utf8"));
  } catch {
    throw new ConfigError(`Invalid baseline metadata: ${metadata}`);
  }
  if (!parsed.approvedReference) {
    if (approvedReceipt(path))
      throw new ConfigError(`Approved reference metadata missing: ${metadata}`);
    return;
  }
  const reference = parsed.approvedReference;
  if (
    typeof reference.projectId !== "string" ||
    typeof reference.set !== "string" ||
    typeof reference.sourceRevision !== "string" ||
    typeof reference.targetRevision !== "string" ||
    typeof reference.runId !== "string" ||
    typeof reference.promotedAt !== "string" ||
    !Number.isFinite(Date.parse(reference.promotedAt)) ||
    !reference.projectId ||
    !reference.set ||
    !Number.isSafeInteger(reference.version) ||
    reference.version < 1 ||
    reference.policyVersion !== 1 ||
    typeof reference.checkKey !== "string" ||
    typeof reference.evidenceDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(reference.checkKey) ||
    !/^[a-f0-9]{64}$/.test(reference.evidenceDigest)
  )
    throw new ConfigError(`Invalid approved baseline provenance: ${metadata}`);
  if (check && fingerprint(check) !== reference.checkKey)
    throw new ConfigError(`Approved baseline check identity mismatch: ${path}`);
  const receiptPath = approvedReceiptPath(path);
  if (receiptPath) {
    let receipt: Record<string, unknown>;
    try {
      receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    } catch {
      throw new ConfigError(`Invalid approved snapshot receipt: ${receiptPath}`);
    }
    const keys = [
      "projectId",
      "set",
      "version",
      "runId",
      "sourceRevision",
      "targetRevision",
      "policyVersion",
    ] as const;
    if (
      !receipt ||
      keys.some((key) => receipt[key] !== reference[key]) ||
      !Array.isArray(receipt.checks) ||
      !receipt.checks.some(
        (entry) =>
          entry && entry.key === reference.checkKey && (!check || entry.jobId === check.jobId),
      )
    )
      throw new ConfigError(
        `Approved baseline provenance does not match the pinned receipt: ${path}`,
      );
  }
  for (const [kind, suffix] of [
    ["image", ".png"],
    ["dom", ".dom.json"],
    ["health", ".health.json"],
  ] as const) {
    const expected = parsed.approvedArtifacts?.[kind];
    const file = path.replace(/\.png$/, suffix);
    if (kind === "dom" && !expected) {
      if (existsSync(file)) throw new ConfigError(`Unexpected DOM in approved baseline: ${file}`);
      continue;
    }
    if (
      !expected ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      !existsSync(file) ||
      createHash("sha256").update(readFileSync(file)).digest("hex") !== expected
    )
      throw new ConfigError(`Approved baseline ${kind} checksum mismatch: ${file}`, {
        hint: "Pull this immutable approved version again into a new directory.",
      });
  }
  return reference;
}
