/**
 * @file Chooses inline diffing in source runs or queues CPU work in a pool of built worker
 * threads.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

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
 * event loop stays free for browser traffic. When running from source (tests), the worker file
 * does not exist and diffs run inline.
 *
 * Choose the worker pool when the built worker exists, otherwise use the inline implementation.
 * Both implementations expose run/close so the run lifecycle does not depend on how computation
 * is scheduled.
 */
export function createDiffRunner(size: number): DiffRunner {
  const workerURL = new URL("./diff-worker.js", import.meta.url);
  if (size < 1 || !existsSync(fileURLToPath(workerURL))) return inlineRunner();
  return workerPool(workerURL, size);
}

/**
 * Provide the same asynchronous interface without worker threads. Yield to the event loop once
 * before synchronous diffing so pending browser events get a chance to run.
 */
function inlineRunner(): DiffRunner {
  return {
    /**
     * Compute one task inline after yielding to pending event-loop work.
     */
    run: async (input) => {
      // Yield first so a burst of diffs doesn't starve pending browser events.
      await new Promise((resolve) => setImmediate(resolve));
      return computeDiff(input);
    },
    /**
     * Provide a no-op cleanup Promise for the shared runner interface; this runner owns no
     * workers.
     */
    close: async () => {},
  };
}

interface Pending {
  input: DiffJobInput;
  resolve: (output: DiffJobOutput) => void;
  reject: (error: Error) => void;
}

/**
 * Maintain a pending queue, idle workers and a worker-to-task map up to the configured pool
 * size. Promises connect each queued input to the later worker response.
 */
function workerPool(url: URL, size: number): DiffRunner {
  const queue: Pending[] = [];
  const idle: Worker[] = [];
  const all: Worker[] = [];
  const busy = new Map<Worker, Pending>();
  let nextId = 0;

  /**
   * Create one worker and install result/error handlers before adding it to the pool. A reply
   * resolves or rejects its assigned task, releases the worker and starts queued work.
   */
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

  /**
   * Assign queued tasks to idle workers or create workers while below the size limit. Stop when
   * all workers are busy; their completion handlers will call pump again.
   */
  const pump = () => {
    while (queue.length > 0) {
      const worker = idle.pop() ?? (all.length < size ? spawn() : undefined);
      if (!worker) return;
      const task = queue.shift()!;
      busy.set(worker, task);
      // postMessage copies serializable task data across the thread boundary.
      // busy remembers which Promise must be settled when this worker replies.
      worker.postMessage({ id: nextId++, input: task.input });
    }
  };

  return {
    /**
     * Queue one task and return a Promise settled by the worker's eventual reply.
     */
    run: (input) =>
      new Promise((resolve, reject) => {
        queue.push({ input, resolve, reject });
        pump();
      }),
    /**
     * Terminate all owned workers and clear the pool bookkeeping after they finish.
     */
    close: async () => {
      await Promise.all(all.map((worker) => worker.terminate()));
      all.length = 0;
      idle.length = 0;
    },
  };
}
