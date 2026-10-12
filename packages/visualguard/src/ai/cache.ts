/**
 * @file Hashes prepared requests and stores/reads versioned, validated, expiring analysis cache
 * records.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalyzeOutput } from "./tasks/analyze-diff.js";
import { fingerprint } from "../core/provenance.js";
import { VisualAnalysisSchema } from "./tasks/analyze-diff.js";

/**
 * Hash the exact multimodal request, using content digests for binary parts.
 *
 * Build a stable fingerprint of the complete request, including image content. Replacing binary
 * buffers with digests keeps the key compact while still distinguishing different screenshots.
 */
export function requestCacheKey(request: unknown): string {
  /**
   * Recursively turn buffers into SHA-256 digests and visit array/object members. Recursion
   * means nested image data participates in the cache key instead of being ignored.
   */
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
  /**
   * Remember the cache directory and maximum entry age in milliseconds. TypeScript parameter
   * properties automatically create the corresponding instance fields.
   */
  constructor(
    private readonly dir: string,
    private readonly ttlMs = 86_400_000,
  ) {}

  /**
   * Read a cache entry only when its version, age, analysis schema and token counters are
   * valid. Missing, expired or corrupt entries return undefined so the caller can perform fresh
   * analysis.
   */
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

  /**
   * Create the cache directory if needed and save the analysis with a version and timestamp.
   * The timestamp is used to expire the entry on a later read.
   */
  set(key: string, value: AnalyzeOutput): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${key}.json`),
      JSON.stringify({ version: 2, createdAt: Date.now(), value }),
    );
  }
}
