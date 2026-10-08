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
