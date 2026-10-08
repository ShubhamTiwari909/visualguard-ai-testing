import { cpus } from "node:os";
import { resolve } from "node:path";
import { ConfigError } from "../core/errors.js";
import type { Env } from "../core/types.js";
import { normalizeBaseURL } from "./urls.js";
import type { ParsedConfig, RouteInput } from "./schema.js";

/** Values from CLI flags and positional arguments. They win over env vars and the config file. */
export interface ConfigOverrides {
  production?: string;
  staging?: string;
  /** `--route` values (or routes from positional URLs): replace the configured routes. */
  routes?: RouteInput[];
  /** `--only` globs: filter the route list. */
  only?: string[];
  /** `--viewport` names: run only these viewports. */
  viewports?: string[];
  concurrency?: number;
  /** `--provider` / `--model`. */
  aiProvider?: "gemini" | "ollama" | "none";
  aiModel?: string;
}

export interface ResolvedConfig extends ParsedConfig {
  cwd: string;
  configPath?: string;
  /** Absolute path of `output.dir`. */
  outputDir: string;
  only: string[];
  concurrency: number;
}

export const ENV_VARS = {
  production: "VISUALGUARD_PRODUCTION_URL",
  staging: "VISUALGUARD_STAGING_URL",
} as const satisfies Record<Env, string>;

function pickBaseURL(
  env: Env,
  overrides: ConfigOverrides,
  vars: NodeJS.ProcessEnv,
  config: ParsedConfig,
): string | undefined {
  const value = overrides[env] ?? (vars[ENV_VARS[env]] || undefined) ?? config.baseURL[env];
  if (value === undefined) return undefined;
  // Validates and throws a ConfigError with a hint for malformed URLs.
  normalizeBaseURL(value);
  return value;
}

export function defaultConcurrency(): number {
  return Math.max(1, Math.min(4, cpus().length));
}

/** Applies precedence: CLI flags → env vars → config file → defaults (PLAN.md §6.2). */
export function resolveConfig(
  config: ParsedConfig,
  options: {
    cwd: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    overrides?: ConfigOverrides;
  },
): ResolvedConfig {
  const overrides = options.overrides ?? {};
  const vars = options.env ?? process.env;

  const baseURL = {
    production: pickBaseURL("production", overrides, vars, config),
    staging: pickBaseURL("staging", overrides, vars, config),
  };

  let routes = config.routes;
  if (overrides.routes && overrides.routes.length > 0) {
    for (const route of overrides.routes) {
      if (typeof route === "string" && !route.startsWith("/")) {
        throw new ConfigError(`--route "${route}" must be a path starting with "/"`, {
          hint: "Use --staging/--production to change the site, and --route for the page.",
        });
      }
    }
    routes = overrides.routes;
  }

  let viewports = config.viewports;
  if (overrides.viewports && overrides.viewports.length > 0) {
    const unknown = overrides.viewports.filter((name) => !(name in config.viewports));
    if (unknown.length > 0) {
      throw new ConfigError(`Unknown viewport: ${unknown.join(", ")}`, {
        hint: `Configured viewports: ${Object.keys(config.viewports).join(", ")}`,
      });
    }
    viewports = Object.fromEntries(
      Object.entries(config.viewports).filter(([name]) => overrides.viewports!.includes(name)),
    );
  }

  const providerFromEnv = vars.VISUALGUARD_AI_PROVIDER;
  if (providerFromEnv && !["gemini", "ollama", "none"].includes(providerFromEnv)) {
    throw new ConfigError(
      `VISUALGUARD_AI_PROVIDER must be gemini, ollama or none (got "${providerFromEnv}")`,
    );
  }
  const provider =
    overrides.aiProvider ??
    (providerFromEnv as ConfigOverrides["aiProvider"]) ??
    config.ai.provider;
  const ai = {
    ...config.ai,
    provider,
    // A model id belongs to one provider: switching provider drops the configured model.
    model: overrides.aiModel ?? (provider === config.ai.provider ? config.ai.model : undefined),
  };

  return {
    ...config,
    ai,
    baseURL,
    routes,
    viewports,
    cwd: options.cwd,
    configPath: options.configPath,
    outputDir: resolve(options.cwd, config.output.dir),
    only: overrides.only ?? [],
    concurrency: overrides.concurrency ?? config.concurrency ?? defaultConcurrency(),
  };
}
