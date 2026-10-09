import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ResolvedConfig } from "../config/resolve.js";
import { ConfigError } from "./errors.js";
import type { JobSpec } from "./types.js";

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

export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");

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

export function renderingIdentity(
  config: ResolvedConfig,
  job: Pick<JobSpec, "viewport" | "waitFor" | "mask" | "hide">,
  project?: string,
) {
  const { diff: _diff, ...policy } = capturePolicy(config, job);
  return { platform: process.platform, project, policy };
}

export function writeBaselineMetadata(path: string, identity: unknown, cwd: string): void {
  writeFileSync(
    path.replace(/\.png$/, ".meta.json"),
    `${JSON.stringify({ version: 1, fingerprint: fingerprint(identity), identity, sourceRevision: sourceRevision(cwd), createdAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

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
