/**
 * @file Git subprocess helpers for repository root, dirty paths and files changed since a ref.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run Git with an argument array and normalize its status/stdout/stderr. Passing arguments
 * directly avoids shell interpolation of paths or refs.
 */
export function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

/**
 * Ask Git for the repository root and return undefined when the directory is outside a usable
 * checkout. Callers can then provide an environment-specific error.
 */
export function gitRoot(cwd: string): string | undefined {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout : undefined;
}

/**
 * Uncommitted changes (staged, unstaged or untracked), ignoring VisualGuard's own files.
 *
 * List uncommitted paths while excluding VisualGuard's own generated state/acceptance file.
 * Parse Git's porcelain output, which is intended for programmatic consumption.
 */
export function dirtyFiles(cwd: string): string[] {
  const result = git(cwd, ["status", "--porcelain", "--untracked-files=normal"]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(
      (file) => !file.startsWith(".visualguard") && !file.startsWith("visualguard.accepted.json"),
    );
}

/**
 * Files changed between `ref` and HEAD, plus uncommitted ones; paths relative to the repo root.
 *
 * Combine committed changes since a comparison ref with current tracked working changes. A Set
 * removes duplicate paths from the two Git outputs.
 */
export function changedSince(cwd: string, ref: string): string[] {
  const committed = git(cwd, ["diff", "--name-only", `${ref}...HEAD`]);
  const working = git(cwd, ["diff", "--name-only", "HEAD"]);
  return [
    ...new Set([...committed.stdout.split("\n"), ...working.stdout.split("\n")].filter(Boolean)),
  ];
}
