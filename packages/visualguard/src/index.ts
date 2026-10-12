/**
 * @file Public API barrel: exports configuration/run/status helpers, reporters and types; does
 * not start a run.
 *
 * This is the public library entry point. Export statements expose selected helpers/types to
 * package consumers; importing this module does not itself start capture. Internal relative
 * imports use .js extensions because the published output is JavaScript.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

export { VERSION } from "./core/version.js";

// Configuration
export { defineConfig, loadConfig, loadEnvFiles, parseConfig } from "./config/load.js";
export { resolveConfig, type ConfigOverrides, type ResolvedConfig } from "./config/resolve.js";
export { joinURL, expandRoutes, routeSlug } from "./config/urls.js";
export type {
  VisualGuardConfig,
  ParsedConfig,
  RouteInput,
  RouteObject,
  ViewportConfig,
  CaptureHook,
  CaptureHookContext,
} from "./config/schema.js";

// Running
export {
  createRun,
  Run,
  type Reporter,
  type ReporterContext,
  type RunOptions,
  type RunOutcome,
} from "./core/run.js";
export type { RunEvent } from "./core/events.js";
export { planJobs, buildJobs } from "./core/jobs.js";
export { exitCodeFor, summarize } from "./core/status.js";
export { findRun, readManifest, readRunIndex } from "./core/runs.js";
export { VisualGuardError, ConfigError, EnvironmentError, ExitCode } from "./core/errors.js";

// Reporters
export { terminalReporter } from "./reporters/terminal.js";
export { jsonReporter } from "./reporters/json.js";

export type * from "./core/types.js";
