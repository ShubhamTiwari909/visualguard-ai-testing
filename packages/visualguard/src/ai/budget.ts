/**
 * @file Shared generation/network/token/deadline ledger, provider wrapping and cumulative saved
 * run-usage persistence.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import {
  AIError,
  addUsage,
  type AIProvider,
  type GenerateRequest,
  type GenerateResult,
  type Usage,
} from "./provider.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One ledger shared by analysis or by all patch attempts in a fix invocation.
 */
export class AIBudget {
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  generationAttempts = 0;
  networkAttempts = 0;
  readonly signal: AbortSignal;
  /**
   * Store the configured limits and create one cancellation signal that combines the caller's
   * cancellation with a deadline. AbortSignal.any aborts when either input signal aborts.
   */
  constructor(
    readonly settings: {
      maxGenerationAttempts?: number;
      maxNetworkAttempts?: number;
      maxTokens?: number;
      timeoutMs?: number;
    },
    signal?: AbortSignal,
  ) {
    const timeout = AbortSignal.timeout(settings.timeoutMs ?? 120_000);
    this.signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
  /**
   * Throw if the operation was cancelled or its recorded token total has reached the limit.
   * Call this before more work so a stopped budget cannot continue issuing requests.
   */
  check(): void {
    this.signal.throwIfAborted();
    if (this.usage.inputTokens + this.usage.outputTokens >= (this.settings.maxTokens ?? 200_000))
      throw new AIError("AI token budget reached", { stopsRun: true });
  }
  /**
   * Reserve one generation attempt after checking cancellation and token limits. Incrementing
   * before the attempt means failed model generations still consume the attempt budget.
   */
  generation(): void {
    this.check();
    if (this.generationAttempts >= (this.settings.maxGenerationAttempts ?? 60))
      throw new AIError("AI generation-attempt budget reached", { stopsRun: true });
    this.generationAttempts++;
  }
  /**
   * Reserve one outgoing provider request. Transport retries count here too, so retrying an
   * answer cannot bypass the network limit.
   */
  network(): void {
    this.check();
    if (this.networkAttempts >= (this.settings.maxNetworkAttempts ?? 120))
      throw new AIError("AI network-attempt budget reached", { stopsRun: true });
    this.networkAttempts++;
  }
  /**
   * Add a completed request's token usage to the shared ledger. This mutates the budget totals;
   * it does not call the model.
   */
  record(usage: Usage): void {
    addUsage(this.usage, usage);
  }
  /**
   * Load previously recorded counters after rejecting negative or non-finite numbers. Optional
   * counters default to zero so older saved reports can still be read.
   */
  restore(snapshot: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens?: number;
    generationAttempts?: number;
    networkAttempts?: number;
  }): void {
    for (const value of Object.values(snapshot))
      if (typeof value === "number" && (!Number.isFinite(value) || value < 0))
        throw new AIError("Invalid saved AI usage");
    this.usage.inputTokens = snapshot.inputTokens;
    this.usage.outputTokens = snapshot.outputTokens;
    this.usage.thinkingTokens = snapshot.thinkingTokens;
    this.generationAttempts = snapshot.generationAttempts ?? 0;
    this.networkAttempts = snapshot.networkAttempts ?? 0;
  }
  /**
   * Return a serializable copy of token and attempt counters. Object spread copies the current
   * numbers into a new object for saving in a report.
   */
  snapshot() {
    return {
      ...this.usage,
      generationAttempts: this.generationAttempts,
      networkAttempts: this.networkAttempts,
    };
  }
}

/**
 * Wrap a provider with the shared cancellation signal and usage accounting. Providers that
 * implement their own budget hooks count internal retries; other providers are counted at their
 * public generate boundary.
 */
export function budgetedProvider(provider: AIProvider, budget: AIBudget): AIProvider {
  return {
    name: provider.name,
    model: provider.model,
    capabilities: provider.capabilities,
    // This returned callback closes over the provider and budget supplied to the factory.
    // It runs for each request, rather than when budgetedProvider itself is called.
    /**
     * Generate through the wrapped provider using the combined request/budget signal. Count
     * work at this boundary only when the provider cannot account for its own internal retries.
     */
    generate: async <T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> => {
      const signal = request.signal
        ? AbortSignal.any([request.signal, budget.signal])
        : budget.signal;
      // External providers can participate by declaring budget support. Otherwise account at
      // their public generate boundary; hidden transport retries cannot be observed.
      if (!provider.supportsBudget) {
        budget.generation();
        budget.network();
      }
      const result = await provider.generate({ ...request, signal, budget });
      if (!provider.supportsBudget) budget.record(result.usage);
      return result;
    },
  };
}

/**
 * Keep cumulative run usage monotonic across analyze, terminal fix and report fix.
 *
 * Restore the greatest saved value for each usage counter from run and fix artifacts. Taking
 * maxima avoids double-counting copies of the same usage while preventing a resumed operation
 * from resetting its budget.
 */
export function restoreRunUsage(
  budget: AIBudget,
  runDir: string,
  previous?: Usage & { generationAttempts?: number; networkAttempts?: number },
): void {
  const usage = {
    inputTokens: previous?.inputTokens ?? 0,
    outputTokens: previous?.outputTokens ?? 0,
    thinkingTokens: previous?.thinkingTokens ?? 0,
    generationAttempts: previous?.generationAttempts ?? 0,
    networkAttempts: previous?.networkAttempts ?? 0,
  };
  for (const file of ["ai-usage.json", "fix-results.json"]) {
    const path = join(runDir, file);
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const saved = parsed.version === 1 ? parsed.usage : undefined;
    if (saved)
      for (const key of Object.keys(usage) as Array<keyof typeof usage>) {
        const value = saved[key] ?? 0;
        if (!Number.isFinite(value) || value < 0) throw new AIError("Invalid saved AI usage");
        usage[key] = Math.max(usage[key], value);
      }
  }
  budget.restore(usage);
}

/**
 * Write a versioned AI usage snapshot into the run directory. Later analysis or fixes can
 * restore these counters and continue enforcing the cumulative budget.
 */
export function persistRunUsage(budget: AIBudget, runDir: string): void {
  writeFileSync(
    join(runDir, "ai-usage.json"),
    JSON.stringify({ version: 1, usage: budget.snapshot() }, null, 2),
  );
}
