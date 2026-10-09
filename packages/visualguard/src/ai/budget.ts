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

/** One ledger shared by analysis or by all patch attempts in a fix invocation. */
export class AIBudget {
  readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  generationAttempts = 0;
  networkAttempts = 0;
  readonly signal: AbortSignal;
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
  check(): void {
    this.signal.throwIfAborted();
    if (this.usage.inputTokens + this.usage.outputTokens >= (this.settings.maxTokens ?? 200_000))
      throw new AIError("AI token budget reached", { stopsRun: true });
  }
  generation(): void {
    this.check();
    if (this.generationAttempts >= (this.settings.maxGenerationAttempts ?? 60))
      throw new AIError("AI generation-attempt budget reached", { stopsRun: true });
    this.generationAttempts++;
  }
  network(): void {
    this.check();
    if (this.networkAttempts >= (this.settings.maxNetworkAttempts ?? 120))
      throw new AIError("AI network-attempt budget reached", { stopsRun: true });
    this.networkAttempts++;
  }
  record(usage: Usage): void {
    addUsage(this.usage, usage);
  }
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
  snapshot() {
    return {
      ...this.usage,
      generationAttempts: this.generationAttempts,
      networkAttempts: this.networkAttempts,
    };
  }
}

export function budgetedProvider(provider: AIProvider, budget: AIBudget): AIProvider {
  return {
    name: provider.name,
    model: provider.model,
    capabilities: provider.capabilities,
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

/** Keep cumulative run usage monotonic across analyze, terminal fix and report fix. */
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

export function persistRunUsage(budget: AIBudget, runDir: string): void {
  writeFileSync(
    join(runDir, "ai-usage.json"),
    JSON.stringify({ version: 1, usage: budget.snapshot() }, null, 2),
  );
}
