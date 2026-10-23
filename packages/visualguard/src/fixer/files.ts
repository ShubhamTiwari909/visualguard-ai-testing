/**
 * @file Enumerates eligible source files with protected paths/extensions, size/count limits and
 * skipped build/dependency directories.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { matchesAny } from "../config/glob.js";

const SOURCE_EXTENSIONS =
  /\.(tsx|ts|jsx|js|mjs|cjs|vue|svelte|astro|html|css|scss|sass|less|mdx|md)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".visualguard",
  "coverage",
]);
/**
 * Never edited, whatever `fix.include` says.
 */
const PROTECTED = [
  /(^|\/)\.env/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
  /(^|\/)[^/]*\.config\.[cm]?[jt]s$/,
  /(^|\/)visualguard\./,
];
const MAX_FILE_BYTES = 300_000;
const MAX_FILES = 6_000;

/**
 * Check whether a path belongs to a protected file category. Array.some returns true at the
 * first matching protection rule.
 */
export function isProtected(path: string): boolean {
  return PROTECTED.some((pattern) => pattern.test(path));
}

/**
 * Require a source extension, an allowed include glob and no protection rule. All three
 * conditions must pass before the fixer may use the path.
 */
export function isEditable(path: string, include: readonly string[]): boolean {
  return SOURCE_EXTENSIONS.test(path) && !isProtected(path) && matchesAny(path, include);
}

/**
 * Resolve a project-relative edit path to its file, or throw when it could reach outside the
 * project. Edit paths can come from a model, so only plain forward-slash paths are accepted: no
 * absolute or drive paths, backslashes, or empty, `.` and `..` segments. No existing component
 * may be a symbolic link, so a link inside the project cannot redirect a write elsewhere.
 */
export function resolveEditPath(cwd: string, path: string): string {
  const segments = path.split("/");
  if (
    isAbsolute(path) ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new Error(`${path} is not a relative path inside the project.`);
  let current = cwd;
  for (const segment of segments) {
    current = join(current, segment);
    let isLink: boolean;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      break; // Missing; callers decide whether the file must exist.
    }
    if (isLink)
      throw new Error(`${path} goes through a symbolic link; the fixer only edits real files.`);
  }
  return join(cwd, ...segments);
}

export interface SourceFile {
  /**
   * Relative to the project root, with forward slashes.
   */
  path: string;
  content: string;
}

/**
 * Source files the fixer may read and edit.
 *
 * Collect bounded, readable source files that the fixer is allowed to inspect/edit. Skip
 * ignored folders, links and oversized files rather than recursively following arbitrary
 * project contents.
 */
export function listSourceFiles(cwd: string, include: readonly string[]): SourceFile[] {
  const files: SourceFile[] = [];
  /**
   * Recursively visit candidate directories while honoring file-count and size limits. Add
   * readable file content with project-relative paths to the outer files array.
   */
  const walk = (dir: string) => {
    if (files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".storybook") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      const path = relative(cwd, full).split("\\").join("/");
      if (!entry.isFile() || !isEditable(path, include)) continue;
      if (statSync(full).size > MAX_FILE_BYTES) continue;
      files.push({ path, content: readFileSync(full, "utf8") });
    }
  };
  walk(cwd);
  return files;
}
