import { join, resolve } from "node:path";
import { loadConfig, loadEnvFiles, parseConfig } from "./config/load.js";
import { resolveConfig, type ConfigOverrides } from "./config/resolve.js";
import type { VisualGuardConfig } from "./config/schema.js";
import { ConfigError, type ExitCode } from "./core/errors.js";
import type { RunEvent } from "./core/events.js";
import { createRun, type RunOptions, type RunOutcome } from "./core/run.js";
import { exitCodeFor, FAIL_ON_VALUES } from "./core/status.js";
import { githubSummaryReporter, junitReporter } from "./reporters/ci.js";
import { writeReport } from "./reporters/html.js";

export interface SDKReports {
  /** Generate index.html in the run directory. Default: true. */
  html?: boolean;
  /** true writes runDir/junit.xml; a string resolves against cwd. Default: true. */
  junit?: boolean | string;
  /** Append to GITHUB_STEP_SUMMARY. Requires that environment variable. Default: false. */
  githubSummary?: boolean;
  /** Optional published report URL used in the GitHub summary. Does not upload anything. */
  reportURL?: string;
}

export interface RunVisualGuardOptions extends Pick<
  RunOptions,
  "signal" | "ai" | "aiCache" | "debug" | "shard" | "runGroup" | "failOn" | "reporters"
> {
  cwd?: string;
  /** Inline config skips file discovery. Mutually exclusive with configPath. */
  config?: VisualGuardConfig;
  configPath?: string;
  overrides?: ConfigOverrides;
  /** Replaces process.env for SDK resolution/providers; copied, never mutated. */
  env?: NodeJS.ProcessEnv;
  /** Load .env and .env.local into the copied environment. Default: true. */
  loadEnv?: boolean;
  /** Explicitly update snapshots. Only valid with config.mode = baseline. */
  updateBaselines?: boolean;
  reports?: SDKReports;
  /** Synchronous progress observer; exceptions are ignored by the run's reporter boundary. */
  onEvent?: (event: RunEvent) => void;
}

export interface VisualGuardResult extends RunOutcome {
  /** Policy verdict; the SDK does not change process.exitCode. */
  exitCode: ExitCode;
  passed: boolean;
  /** Absolute local paths. Upload the whole runDir to retain screenshot/diff references. */
  artifacts: {
    manifest: string;
    html?: string;
    junit?: string;
    githubSummary?: string;
  };
}

/** Run the CLI's comparison engine from Node.js without owning the caller's process. */
export async function runVisualGuard(options: RunVisualGuardOptions = {}): Promise<VisualGuardResult> {
  options.signal?.throwIfAborted();
  if (options.config !== undefined && options.configPath !== undefined) {
    throw new ConfigError("Use either config or configPath, not both.");
  }
  const failOn = options.failOn ?? "regression";
  if (!FAIL_ON_VALUES.includes(failOn)) throw new ConfigError("failOn must be regression, review or any.");
  const shard = options.shard;
  if (shard && (!Number.isSafeInteger(shard.index) || !Number.isSafeInteger(shard.total) ||
    shard.index < 1 || shard.total < 1 || shard.index > shard.total)) {
    throw new ConfigError("shard needs integer index and total, with 1 <= index <= total.");
  }
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = { ...(options.env ?? process.env) };
  if (options.loadEnv !== false) loadEnvFiles(cwd, env);
  const loaded = options.config === undefined
    ? await loadConfig({ cwd, configPath: options.configPath })
    : { config: parseConfig(options.config, "SDK config"), configPath: undefined };
  const config = resolveConfig(loaded.config, { cwd, configPath: loaded.configPath, env, overrides: options.overrides });
  // Validate resolver overrides too; low-level callers may otherwise bypass schema checks.
  parseConfig(config, "resolved SDK config");
  if (config.mode === "baseline") {
    if (!config.baseURL.staging) throw new ConfigError("Baseline mode requires baseURL.staging.");
    config.baseURL.production ??= config.baseURL.staging;
  } else {
    if (options.updateBaselines) throw new ConfigError("updateBaselines requires mode: baseline.");
    if (!config.baseURL.production || !config.baseURL.staging) {
      throw new ConfigError("Compare mode requires baseURL.production and baseURL.staging.");
    }
  }
  const reports = options.reports ?? {};
  if (typeof reports.junit === "string" && !reports.junit.trim()) throw new ConfigError("reports.junit must be a non-empty path.");
  if (reports.githubSummary && !env.GITHUB_STEP_SUMMARY?.trim()) {
    throw new ConfigError("reports.githubSummary requires GITHUB_STEP_SUMMARY.");
  }
  const artifacts: VisualGuardResult["artifacts"] = { manifest: "" };
  const outcome = await createRun(config, {
    signal: options.signal,
    ai: options.ai,
    aiCache: options.aiCache,
    debug: options.debug,
    shard,
    runGroup: options.runGroup,
    failOn,
    env,
    mode: config.mode,
    ...(config.mode === "baseline" ? {
      baselineDir: resolve(cwd, config.baseline.dir),
      updateBaselines: options.updateBaselines,
    } : {}),
    reporters: [{
      name: "sdk",
      onEvent: options.onEvent,
      async onRunEnd(manifest, context) {
        artifacts.manifest = join(context.runDir, "manifest.json");
        if (reports.html !== false) artifacts.html = writeReport(context.runDir, manifest);
        if (reports.junit !== false) {
          artifacts.junit = typeof reports.junit === "string"
            ? resolve(cwd, reports.junit) : join(context.runDir, "junit.xml");
          await junitReporter(artifacts.junit, failOn).onRunEnd!(manifest, context);
        }
        if (reports.githubSummary) {
          artifacts.githubSummary = resolve(cwd, env.GITHUB_STEP_SUMMARY!);
          await githubSummaryReporter(artifacts.githubSummary, reports.reportURL).onRunEnd!(manifest, context);
        }
      },
    }, ...(options.reporters ?? [])],
  }).start();
  const exitCode = exitCodeFor(outcome.manifest, failOn);
  return { ...outcome, artifacts, exitCode, passed: exitCode === 0 };
}
