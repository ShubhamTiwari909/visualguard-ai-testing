import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzeOutput } from "./tasks/analyze-diff.js";
import { fingerprint } from "../core/provenance.js";
import { VisualAnalysisSchema } from "./tasks/analyze-diff.js";

/** Hash the exact multimodal request, using content digests for binary parts. */
export function requestCacheKey(request: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Buffer.isBuffer(value)) return { sha256: createHash("sha256").update(value).digest("hex") };
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
    return value;
  };
  return fingerprint(normalize(request));
}

export class AnalysisCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs = 86_400_000,
  ) {}

  get(key: string): AnalyzeOutput | undefined {
    const path = join(this.dir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const entry = JSON.parse(readFileSync(path, "utf8"));
      if (
        entry.version !== 2 ||
        !Number.isFinite(entry.createdAt) ||
        Date.now() - entry.createdAt > this.ttlMs
      )
        return undefined;
      const parsed = VisualAnalysisSchema.safeParse(entry.value?.analysis);
      const usage = entry.value?.usage;
      if (
        !parsed.success ||
        !usage ||
        ![usage.inputTokens, usage.outputTokens].every((v) => Number.isFinite(v) && v >= 0)
      )
        return undefined;
      return entry.value as AnalyzeOutput;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: AnalyzeOutput): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${key}.json`),
      JSON.stringify({ version: 2, createdAt: Date.now(), value }),
    );
  }
}
