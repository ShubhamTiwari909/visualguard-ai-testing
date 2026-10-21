import { resolve } from "node:path";
import { ConfigError } from "../core/errors.js";
import type { ResolvedConfig } from "./resolve.js";
import { normalizeBaseURL } from "./urls.js";

export interface MonitorOptions {
  /** Exact snapshot folder, resolved against cwd. Omit to use config.monitor.dir/<host>. */
  dir?: string;
  /** Defaults to config.monitor.update (normally unless-regression). */
  update?: "unless-regression" | "always";
  /** Deliberately replace references, including incompatible snapshots. */
  reset?: boolean;
}

/** Keep CLI and SDK monitor setup on the same capture and snapshot policy. */
export function resolveMonitorRun(config: ResolvedConfig, options: MonitorOptions = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new ConfigError("monitor must be true or an options object.");
  }
  for (const key of Object.keys(options)) {
    if (!["dir", "update", "reset"].includes(key)) {
      throw new ConfigError(`Unknown monitor option: ${key}. Use dir, update or reset.`);
    }
  }
  if (options.dir !== undefined && (typeof options.dir !== "string" || !options.dir.trim())) {
    throw new ConfigError("monitor.dir must be a non-empty snapshot folder.");
  }
  const update = options.update ?? config.monitor.update;
  if (update !== "always" && update !== "unless-regression") {
    throw new ConfigError("monitor.update must be unless-regression or always.");
  }
  if (options.reset !== undefined && typeof options.reset !== "boolean") {
    throw new ConfigError("monitor.reset must be a boolean.");
  }
  const site = config.baseURL.production ?? config.baseURL.staging;
  if (!site)
    throw new ConfigError("Nothing to monitor: set baseURL.production or baseURL.staging.");
  const host = normalizeBaseURL(site).host.replace(/[^a-z0-9.-]+/gi, "_");
  if (options.dir === undefined && !config.monitor.dir.trim()) {
    throw new ConfigError("config.monitor.dir must not be empty.");
  }
  const snapshotDir =
    options.dir === undefined
      ? resolve(config.cwd, config.monitor.dir, host)
      : resolve(config.cwd, options.dir);
  return {
    config: { ...config, baseURL: { production: site, staging: site } },
    snapshotDir,
    options: {
      mode: "monitor" as const,
      baselineDir: snapshotDir,
      updateBaselines:
        options.reset || update === "always" ? (true as const) : ("unless-regression" as const),
      baselineHealth: true,
    },
  };
}
