import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { computeDiff, type DiffJobInput, type DiffJobOutput } from "./compute.js";

export interface DiffRunner {
  run(input: DiffJobInput): Promise<DiffJobOutput>;
  close(): Promise<void>;
}

/**
 * Diffing is CPU-bound, so in the built package it runs on a pool of worker threads and the
 * event loop stays free for browser traffic. When running from source (tests), the worker
 * file does not exist and diffs run inline.
 */
export function createDiffRunner(size: number): DiffRunner {
  const workerURL = new URL("./diff-worker.js", import.meta.url);
  if (size < 1 || !existsSync(fileURLToPath(workerURL))) return inlineRunner();
  return workerPool(workerURL, size);
}

function inlineRunner(): DiffRunner {
  return {
    run: async (input) => {
      // Yield first so a burst of diffs doesn't starve pending browser events.
      await new Promise((resolve) => setImmediate(resolve));
      return computeDiff(input);
    },
    close: async () => {},
  };
}

interface Pending {
  input: DiffJobInput;
  resolve: (output: DiffJobOutput) => void;
  reject: (error: Error) => void;
}

function workerPool(url: URL, size: number): DiffRunner {
  const queue: Pending[] = [];
  const idle: Worker[] = [];
  const all: Worker[] = [];
  const busy = new Map<Worker, Pending>();
  let nextId = 0;

  const spawn = (): Worker => {
    const worker = new Worker(url);
    worker.on("message", (message: { result?: DiffJobOutput; error?: string }) => {
      const task = busy.get(worker);
      busy.delete(worker);
      if (task) {
        if (message.error !== undefined) task.reject(new Error(message.error));
        else task.resolve(message.result!);
      }
      idle.push(worker);
      pump();
    });
    worker.on("error", (error) => {
      const task = busy.get(worker);
      busy.delete(worker);
      all.splice(all.indexOf(worker), 1);
      task?.reject(error);
      pump();
    });
    all.push(worker);
    return worker;
  };

  const pump = () => {
    while (queue.length > 0) {
      const worker = idle.pop() ?? (all.length < size ? spawn() : undefined);
      if (!worker) return;
      const task = queue.shift()!;
      busy.set(worker, task);
      worker.postMessage({ id: nextId++, input: task.input });
    }
  };

  return {
    run: (input) =>
      new Promise((resolve, reject) => {
        queue.push({ input, resolve, reject });
        pump();
      }),
    close: async () => {
      await Promise.all(all.map((worker) => worker.terminate()));
      all.length = 0;
      idle.length = 0;
    },
  };
}
