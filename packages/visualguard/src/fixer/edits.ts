/**
 * @file Validates/previews/renders edits, checks original contents, applies multi-file changes
 * and rolls back failures.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { isEditable } from "./files.js";

/**
 * One change: replace `search` (copied exactly from the file, occurring once) with `replace`.
 * Search/replace blocks are used instead of unified diffs because models get line numbers and
 * context wrong; these are deterministic to validate (PLAN.md §13.4).
 */
export interface Edit {
  file: string;
  search: string;
  replace: string;
  reason: string;
}

/**
 * Count non-overlapping literal occurrences of search in content. Advance by the full match
 * length and reject an empty search so the loop cannot get stuck.
 */
export function countOccurrences(content: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  for (
    let index = content.indexOf(search);
    index >= 0;
    index = content.indexOf(search, index + search.length)
  )
    count++;
  return count;
}

/**
 * Checks every edit against the files on disk; returns problems in words a model can act on.
 *
 * Check allowed paths, file state and unique search matches before writing anything. Simulate
 * edits in sequence so later replacements are checked against the earlier proposed result.
 */
export function validateEdits(cwd: string, edits: Edit[], include: readonly string[]): string[] {
  const problems: string[] = [];
  if (edits.length === 0) problems.push("No edits were proposed.");
  const contents = new Map<string, string>();
  for (const edit of edits) {
    const path = edit.file.replace(/^\.\//, "");
    if (!isEditable(path, include)) {
      problems.push(
        `${edit.file} is not an editable source file (fix.include, lockfiles, configs and .env are off limits).`,
      );
      continue;
    }
    if (!existsSync(join(cwd, path))) {
      problems.push(`${edit.file} does not exist.`);
      continue;
    }
    // Earlier edits to the same file apply first.
    const content = contents.get(path) ?? readFileSync(join(cwd, path), "utf8");
    const count = countOccurrences(content, edit.search);
    if (edit.search === edit.replace) problems.push(`The edit to ${edit.file} changes nothing.`);
    else if (count === 0)
      problems.push(
        `The search text for ${edit.file} was not found; copy it exactly from the file.`,
      );
    else if (count > 1)
      problems.push(
        `The search text for ${edit.file} appears ${count} times; include more surrounding lines so it is unique.`,
      );
    else
      contents.set(
        path,
        content.replace(edit.search, () => edit.replace),
      );
  }
  return problems;
}

/**
 * The new content of each file after applying the edits in order.
 *
 * Calculate before/after content for each file by applying literal replacements in memory. A
 * replacement callback keeps dollar signs in replacement text from being interpreted by
 * String.replace.
 */
export function previewEdits(
  cwd: string,
  edits: Edit[],
): Map<string, { before: string; after: string }> {
  const result = new Map<string, { before: string; after: string }>();
  for (const edit of edits) {
    const path = edit.file.replace(/^\.\//, "");
    const current = result.get(path) ?? {
      before: readFileSync(join(cwd, path), "utf8"),
      after: "",
    };
    const base = result.has(path) ? current.after : current.before;
    result.set(path, {
      before: current.before,
      after: base.replace(edit.search, () => edit.replace),
    });
  }
  return result;
}

/**
 * Writes the edits; returns the original contents so they can be restored.
 *
 * Verify expected source snapshots, write the edits and retain originals for rollback. If a
 * write fails, attempt to restore every affected file before reporting the failure.
 */
export function applyEdits(
  cwd: string,
  edits: Edit[],
  expected?: ReadonlyMap<string, string>,
): Map<string, string> {
  for (const edit of edits) {
    const path = edit.file.replace(/^\.\//, "");
    if (expected?.has(path) && readFileSync(join(cwd, path), "utf8") !== expected.get(path))
      throw new Error(`${path} changed since the proposal; generate a new proposal.`);
  }
  const preview = previewEdits(cwd, edits);
  const originals = new Map<string, string>();
  try {
    for (const [path, { before, after }] of preview) {
      originals.set(path, before);
      writeFileSync(join(cwd, path), after);
    }
  } catch (error) {
    const failures: unknown[] = [error];
    for (const [path, content] of originals) {
      try {
        writeFileSync(join(cwd, path), content);
      } catch (rollback) {
        failures.push(rollback);
      }
    }
    throw new AggregateError(
      failures,
      "Applying edits failed; rollback attempted for every file.",
      { cause: error },
    );
  }
  return originals;
}

/**
 * Restore every original file, collecting failures instead of stopping after the first failed
 * write. Throw if any restoration failed so partial rollback cannot be reported as success.
 */
export function revertEdits(cwd: string, originals: Map<string, string>): void {
  const failures: unknown[] = [];
  for (const [path, content] of originals) {
    try {
      writeFileSync(join(cwd, path), content);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Some files could not be restored; recover from the saved proposal or Git.",
    );
}

/**
 * A unified diff of the edits, for showing before applying.
 *
 * Generate a unified diff from the in-memory preview for developer review. This formatting step
 * reads source but does not apply the proposal.
 */
export function renderDiff(cwd: string, edits: Edit[]): string {
  return [...previewEdits(cwd, edits)]
    .map(([path, { before, after }]) =>
      createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, undefined, undefined, {
        context: 2,
      })
        .split("\n")
        .slice(2) // drop the "Index:" / "====" header lines
        .join("\n")
        .trimEnd(),
    )
    .join("\n");
}
