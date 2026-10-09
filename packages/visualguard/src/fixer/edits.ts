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

/** Checks every edit against the files on disk; returns problems in words a model can act on. */
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

/** The new content of each file after applying the edits in order. */
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

/** Writes the edits; returns the original contents so they can be restored. */
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

/** A unified diff of the edits, for showing before applying. */
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
