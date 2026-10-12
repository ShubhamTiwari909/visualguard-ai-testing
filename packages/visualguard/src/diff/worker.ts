/**
 * @file Worker entry: receives image-diff tasks, calls computeDiff and sends results/errors to
 * the parent thread.
 *
 * This entry point runs in a Node.js worker thread. Messages from the parent supply work;
 * replies return data/errors rather than sharing the parent's local variables.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { parentPort } from "node:worker_threads";
import { computeDiff, type DiffJobInput } from "./compute.js";

interface Task {
  id: number;
  input: DiffJobInput;
}

parentPort?.on("message", (task: Task) => {
  try {
    parentPort!.postMessage({ id: task.id, result: computeDiff(task.input) });
  } catch (error) {
    parentPort!.postMessage({
      id: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
