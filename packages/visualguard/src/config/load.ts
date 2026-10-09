/**
 * @file Finds/imports config, loads env files, rejects literal keys and reports schema
 * validation errors.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createJiti } from "jiti";
import type { z } from "zod";
import { ConfigError, errorMessage } from "../core/errors.js";
import { configSchema, type ParsedConfig, type VisualGuardConfig } from "./schema.js";

export const CONFIG_FILE_NAMES = [
  "visualguard.config.ts",
  "visualguard.config.mts",
  "visualguard.config.js",
  "visualguard.config.mjs",
  "visualguard.config.cjs",
] as const;

/**
 * Typed helper for `visualguard.config.ts`.
 *
 * Return the configuration unchanged while giving TypeScript a typed authoring boundary. This
 * helper supplies editor hints; validation happens when the config is loaded.
 */
export function defineConfig(config: VisualGuardConfig): VisualGuardConfig {
  return config;
}

/**
 * Search supported config filenames in priority order under the project directory. Return
 * undefined when no file exists so zero-config commands can use defaults.
 */
export function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Loads `.env` then `.env.local` from `cwd` into `env`. Variables that are already set win, so
 * CI secrets and shell exports are never overridden by files.
 *
 * Load .env and .env.local while preserving variables already supplied by the shell or CI.
 * Mutate the chosen environment object and return the paths that were loaded.
 */
export function loadEnvFiles(cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];
  const fromFiles: Record<string, string> = {};
  for (const name of [".env", ".env.local"]) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    Object.assign(fromFiles, parseEnv(readFileSync(path, "utf8")));
    loaded.push(path);
  }
  for (const [key, value] of Object.entries(fromFiles)) {
    if (env[key] === undefined) env[key] = value;
  }
  return loaded;
}

/**
 * Resolves `import { defineConfig } from "visualguard"` to this copy of VisualGuard.
 *
 * Resolve imports of visualguard in a user config to this running package copy. Check
 * source/build candidates so the loader works in development and installed packages.
 */
function selfAlias(): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "index.js"), join(here, "../index.ts")];
  const target = candidates.find((candidate) => existsSync(candidate));
  return target ? { visualguard: target } : {};
}

/**
 * Use jiti to import a JavaScript/TypeScript config without requiring a user build step.
 * Disable its module cache for fresh configuration and wrap import errors with context.
 */
export async function importConfigFile(path: string): Promise<unknown> {
  const jiti = createJiti(import.meta.url, { moduleCache: false, alias: selfAlias() });
  try {
    return await jiti.import(path, { default: true });
  } catch (error) {
    throw new ConfigError(`Could not load ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

export interface LoadedConfig {
  config: ParsedConfig;
  configPath?: string;
}

/**
 * Finds, imports and validates the config. With no config file, returns the defaults so
 * zero-config runs and CLI flags still work.
 *
 * Choose an explicit or discovered config, import it and validate its exported value. With no
 * file, validate defaults so the CLI can still run from supplied flags.
 */
export async function loadConfig(options: {
  cwd: string;
  configPath?: string;
}): Promise<LoadedConfig> {
  let configPath: string | undefined;
  if (options.configPath) {
    configPath = isAbsolute(options.configPath)
      ? options.configPath
      : resolve(options.cwd, options.configPath);
    if (!existsSync(configPath)) throw new ConfigError(`Config file not found: ${configPath}`);
  } else {
    configPath = findConfigFile(options.cwd);
  }

  const raw = configPath ? await importConfigFile(configPath) : {};
  return { config: parseConfig(raw ?? {}, configPath ?? "config"), configPath };
}

const GOOGLE_API_KEY = /^AIza[0-9A-Za-z_-]{30,}$/;

/**
 * Recursively inspect strings inside arrays/objects for recognizable literal API keys. Track
 * each property path so validation can point to the value that should come from the
 * environment.
 */
function findLiteralSecrets(value: unknown, path: string[] = []): string[] {
  if (typeof value === "string") {
    return GOOGLE_API_KEY.test(value) ? [path.join(".") || "(root)"] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findLiteralSecrets(item, [...path, String(index)]));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => findLiteralSecrets(item, [...path, key]));
  }
  return [];
}

const HINTS: Array<[RegExp, string]> = [
  [
    /^diff\.threshold$/,
    'threshold is per-pixel colour tolerance (0–1). Use diff.maxDiffPixels for "how many pixels may differ".',
  ],
  [/^routes/, 'Routes are paths like "/pricing". Put the site address in baseURL.'],
  [/^baseURL/, "Base URLs look like https://example.com. Secrets and tokens belong in env vars."],
  [/^viewports/, "Example: viewports: { desktop: { width: 1440, height: 900 } }"],
];

/**
 * Convert validation issues into readable property paths and hints. Mapping keeps the error
 * list structured until the caller joins it for terminal output.
 */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".") || "(root)";
    const hint = HINTS.find(([pattern]) => pattern.test(path))?.[1];
    return hint ? `${path}: ${issue.message}\n    Hint: ${hint}` : `${path}: ${issue.message}`;
  });
}

/**
 * Reject recognizable hard-coded secrets, then validate the raw configuration with Zod. Return
 * parsed defaults and normalized values, or throw a ConfigError containing all reported issues.
 */
export function parseConfig(raw: unknown, source = "config"): ParsedConfig {
  const secrets = findLiteralSecrets(raw);
  if (secrets.length > 0) {
    throw new ConfigError(
      `Invalid config (${source}): ${secrets.join(", ")} looks like an API key`,
      {
        hint: "Never put API keys in the config file. Set GEMINI_API_KEY in your environment or .env.local instead.",
      },
    );
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `Invalid config (${source})\n  ${formatZodIssues(result.error).join("\n  ")}`,
    );
  }
  return result.data;
}
