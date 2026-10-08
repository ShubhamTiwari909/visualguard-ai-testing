import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

export function gitRoot(cwd: string): string | undefined {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout : undefined;
}

/** Uncommitted changes (staged, unstaged or untracked), ignoring VisualGuard's own files. */
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

/** Files changed between `ref` and HEAD, plus uncommitted ones; paths relative to the repo root. */
export function changedSince(cwd: string, ref: string): string[] {
  const committed = git(cwd, ["diff", "--name-only", `${ref}...HEAD`]);
  const working = git(cwd, ["diff", "--name-only", "HEAD"]);
  return [
    ...new Set([...committed.stdout.split("\n"), ...working.stdout.split("\n")].filter(Boolean)),
  ];
}
