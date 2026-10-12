/**
 * @file Typed run-event definitions and emitter used to notify reporters/listeners.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { CaptureResult, Env, JobResult, JobSpec, RunManifest } from "./types.js";

export type RunEvent =
  | {
      type: "run:start";
      runId: string;
      number: number;
      runDir: string;
      jobs: JobSpec[];
      baseURL: Partial<Record<Env, string>>;
      viewports: Record<string, { width: number; height: number }>;
      routeCount: number;
      warnings: string[];
      ai?: { provider: string; model: string };
      shard?: { index: number; total: number };
      /**
       * Set when shard results are merged (`visualguard merge`).
       */
      mergedShards?: number;
    }
  | { type: "job:start"; job: JobSpec }
  | { type: "job:captured"; job: JobSpec; env: Env; capture: CaptureResult }
  | { type: "job:end"; job: JobResult }
  | { type: "run:end"; manifest: RunManifest; runDir: string }
  | { type: "warning"; message: string };

export type RunEventType = RunEvent["type"];
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;

type Listener<T extends RunEventType> = (event: RunEventOf<T>) => void;
type AnyListener = (event: RunEvent) => void;

/**
 * Small typed event emitter; listeners never break the run.
 */
export class RunEmitter {
  private readonly listeners = new Map<RunEventType, Set<AnyListener>>();

  /**
   * Register a listener in the Set for its event type and return an unsubscribe function. A Set
   * avoids duplicate references; the wrapper cast reconciles the typed API with the internal
   * listener collection.
   */
  on<T extends RunEventType>(type: T, listener: Listener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = listener as unknown as AnyListener;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  /**
   * Deliver an event to listeners for its type. Catch individual listener failures so progress
   * observers cannot interrupt the actual visual-test run.
   */
  emit(event: RunEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken listener must not stop the run.
      }
    }
  }
}
