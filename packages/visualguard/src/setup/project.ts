/**
 * @file Detects framework/package manager and updates gitignore, package scripts/env files;
 * suggests install/exec commands.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { findNextRouters } from "../config/discover/nextjs.js";

export type Framework = "nextjs" | "react" | "vite" | "other";
export type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

export interface ProjectInfo {
  framework: Framework;
  /**
   * Next.js router(s) in use.
   */
  router?: "app" | "pages" | "app+pages";
  packageManager: PackageManager;
  hasPackageJson: boolean;
  playwrightVersion?: string;
}

export const FRAMEWORK_LABEL: Record<Framework, string> = {
  nextjs: "Next.js",
  react: "React",
  vite: "Vite",
  other: "Other",
};

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Read a project package.json when it exists and parses. Return undefined for missing/broken
 * data so detection can still use filesystem clues.
 */
function readPackageJson(cwd: string): PackageJson | undefined {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

/**
 * Choose a package manager from lockfiles, then the invoking user agent, then npm. Prefer
 * concrete project files over a default assumption.
 */
export function detectPackageManager(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  const agent = env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm")) return "pnpm";
  if (agent.startsWith("yarn")) return "yarn";
  if (agent.startsWith("bun")) return "bun";
  return "npm";
}

/**
 * Resolve Playwright relative to the target project's package.json. createRequire uses that
 * location so detection does not accidentally report this workspace's installation.
 */
export function installedPlaywrightVersion(cwd: string): string | undefined {
  try {
    const require = createRequire(join(cwd, "package.json"));
    return (require("playwright/package.json") as { version: string }).version;
  } catch {
    return undefined;
  }
}

/**
 * Combine dependency, directory and package-manager clues into setup metadata. The result
 * guides prompts/templates without executing the application.
 */
export function detectProject(cwd: string): ProjectInfo {
  const pkg = readPackageJson(cwd);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  let framework: Framework = "other";
  if (deps.next) framework = "nextjs";
  else if (deps.vite) framework = "vite";
  else if (deps.react) framework = "react";

  let router: ProjectInfo["router"];
  if (framework === "nextjs") {
    const { appDir, pagesDir } = findNextRouters(cwd);
    router = appDir && pagesDir ? "app+pages" : appDir ? "app" : pagesDir ? "pages" : undefined;
  }

  return {
    framework,
    router,
    packageManager: detectPackageManager(cwd),
    hasPackageJson: Boolean(pkg),
    playwrightVersion: installedPlaywrightVersion(cwd),
  };
}

/**
 * e.g. `pnpm add -D playwright`.
 *
 * Return an executable and argument list for installing development dependencies with the
 * chosen manager. Returning an array lets process callers avoid building a shell string.
 */
export function addDevDependencyCommand(manager: PackageManager, packages: string[]): string[] {
  switch (manager) {
    case "pnpm":
      return ["pnpm", "add", "-D", ...packages];
    case "yarn":
      return ["yarn", "add", "-D", ...packages];
    case "bun":
      return ["bun", "add", "-d", ...packages];
    case "npm":
      return ["npm", "install", "-D", ...packages];
  }
}

/**
 * e.g. `pnpm exec playwright install chromium`.
 *
 * Return the package-manager-specific command for running an installed tool. Different managers
 * use exec, npx or bunx conventions.
 */
export function execCommand(manager: PackageManager, command: string[]): string[] {
  switch (manager) {
    case "pnpm":
      return ["pnpm", "exec", ...command];
    case "yarn":
      return ["yarn", ...command];
    case "bun":
      return ["bunx", ...command];
    case "npm":
      return ["npx", ...command];
  }
}

/**
 * Appends missing entries to .gitignore. Returns the entries that were added.
 *
 * Append only missing ignore entries and return what was added. Preserve existing content and
 * account for a missing final newline.
 */
export function ensureGitignore(cwd: string, entries: string[]): string[] {
  const path = join(cwd, ".gitignore");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter(
    (entry) => !lines.has(entry) && !lines.has(entry.replace(/\/$/, "")),
  );
  if (missing.length === 0) return [];
  const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${prefix}\n# VisualGuard\n${missing.join("\n")}\n`);
  return missing;
}

/**
 * Adds a package.json script unless one with that name exists. Returns true if added.
 *
 * Add a named package.json script only when the name is unused. Preserve detected indentation
 * and report whether the file was changed.
 */
export function addPackageScript(cwd: string, name: string, command: string): boolean {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, "utf8");
  const pkg = JSON.parse(raw) as PackageJson & Record<string, unknown>;
  if (pkg.scripts?.[name]) return false;
  pkg.scripts = { ...pkg.scripts, [name]: command };
  const indent = raw.match(/^(\s+)"/m)?.[1] ?? "  ";
  writeFileSync(path, `${JSON.stringify(pkg, null, indent)}\n`);
  return true;
}

/**
 * Sets KEY=value in an env file, replacing an existing line for KEY.
 *
 * Replace or append one KEY=value line in an environment file. Escape the key for matching and
 * preserve unrelated settings.
 */
export function setEnvVar(path: string, key: string, value: string): void {
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${line}\n`;
  writeFileSync(path, next);
}
