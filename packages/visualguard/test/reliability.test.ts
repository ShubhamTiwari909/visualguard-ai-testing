/**
 * @file Tests F01-F12 invariants: acceptance/AI guards, baseline identity, eval denominator,
 * budgets/cache, stale edits and shards.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evaluationCases, policyMetrics } from "../../../evals/metrics.mjs";
import { AIBudget, budgetedProvider } from "../src/ai/budget.js";
import { AnalysisCache, requestCacheKey } from "../src/ai/cache.js";
import { statusWithAnalysis } from "../src/ai/analyze-job.js";
import { acceptJobs, applyAccepted } from "../src/core/accepted.js";
import { mergeRuns } from "../src/core/merge.js";
import {
  assertBaselineCompatible,
  renderingIdentity,
  writeBaselineMetadata,
} from "../src/core/provenance.js";
import type { JobResult, RunManifest } from "../src/core/types.js";
import { autoFix } from "../src/fixer/auto.js";
import { applyEdits, validateEdits } from "../src/fixer/edits.js";
import { applyAndVerify } from "../src/fixer/fix.js";
import { runCommand } from "../src/fixer/verify.js";
import { testConfig } from "./helpers/config.js";
import { analysis, MockProvider } from "./helpers/mock-provider.js";

/**
 * Create a unique temporary directory for reliability-test artifacts. Unique names keep tests
 * from sharing saved usage or shard files.
 */
const temporary = () => mkdtempSync(join(tmpdir(), "vg-reliability-"));
/**
 * Build a minimal review job with a stable ID and healthy capture. Tests can alter manifest
 * relationships without launching a browser.
 */
function job(id = "a"): JobResult {
  return {
    id,
    route: `/${id}`,
    name: id,
    viewport: "desktop",
    status: "review",
    urls: { production: `https://p.test/${id}`, staging: `https://s.test/${id}` },
    captures: {
      production: {
        image: "p.png",
        size: { width: 1, height: 1 },
        durationMs: 0,
        attempts: 1,
        health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
      },
      staging: {
        image: "s.png",
        size: { width: 1, height: 1 },
        durationMs: 0,
        attempts: 1,
        health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
      },
    },
    regions: [],
    durationMs: 0,
  };
}

describe("reliability policies", () => {
  it("exact visual acceptance never hides a health regression or review", () => {
    const dir = temporary();
    writeFileSync(join(dir, "p.png"), "p");
    writeFileSync(join(dir, "s.png"), "s");
    const original = job();
    const accepted = acceptJobs({ version: 1, accepted: [] }, [original], dir).file;
    for (const severity of ["regression", "review"] as const) {
      const current = {
        ...original,
        status: severity,
        findings: [{ source: "health" as const, severity, message: "New request failure" }],
      };
      expect(applyAccepted(current, dir, accepted, "exact").status).toBe(severity);
    }
  });

  it("advisory AI and health review findings cannot be waived by noise", () => {
    const noise = { classification: "noise" as const, confidence: 1 };
    expect(statusWithAnalysis("review", [], noise, { noiseConfidence: 0.8, advisory: true })).toBe(
      "review",
    );
    expect(
      statusWithAnalysis(
        "review",
        [{ source: "health", severity: "review", message: "New a11y failure" }],
        noise,
        { noiseConfidence: 0.8 },
      ),
    ).toBe("review");
    expect(
      statusWithAnalysis(
        "regression",
        [],
        { classification: "intentional", confidence: 1 },
        { noiseConfidence: 0.8 },
      ),
    ).toBe("regression");
  });

  it("automatic fixing refuses an unverified configuration before creating a branch", async () => {
    const config = testConfig({ fix: { enabled: true } });
    execFileSync("git", ["init", "-q"], { cwd: config.cwd });
    await expect(autoFix(config, {})).rejects.toThrow(/requires fix.verify.server/);
    expect(existsSync(join(config.outputDir, "worktrees"))).toBe(false);
  });

  it("baseline metadata rejects changed viewport/theme and requires explicit legacy migration", () => {
    const config = testConfig({});
    const spec = { viewport: "desktop", mask: [], hide: [] };
    const path = join(config.cwd, "baseline.png");
    writeFileSync(path, "image");
    expect(() => assertBaselineCompatible(path, renderingIdentity(config, spec), "error")).toThrow(
      /metadata missing/,
    );
    expect(() =>
      assertBaselineCompatible(path, renderingIdentity(config, spec), "allow"),
    ).not.toThrow();
    writeBaselineMetadata(path, renderingIdentity(config, spec), config.cwd);
    expect(() =>
      assertBaselineCompatible(path, renderingIdentity(config, spec), "error"),
    ).not.toThrow();
    expect(() =>
      assertBaselineCompatible(
        path,
        renderingIdentity(
          { ...config, viewports: { desktop: { width: 1000, height: 900 } } },
          spec,
        ),
        "error",
      ),
    ).toThrow(/do not match/);
    expect(() =>
      assertBaselineCompatible(
        path,
        renderingIdentity({ ...config, browser: { ...config.browser, colorScheme: "dark" } }, spec),
        "error",
      ),
    ).toThrow(/do not match/);
  });

  it("counts an unexpected pass and a missing capture as eval misses", () => {
    const cases = evaluationCases(
      { jobs: [{ ...job("broken"), status: "pass" }] },
      { "/broken": "regression", "/missing": { desktop: "regression" } },
      ["desktop"],
    );
    expect(cases).toHaveLength(2);
    expect(policyMetrics(cases)).toMatchObject({
      regressionRecall: 0,
      falseGreenRate: 0.5,
      errorCases: 1,
    });
  });

  it("checks stale proposals and handles sequential removal-to-empty edits", () => {
    const dir = temporary();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.css"), "abc");
    const edits = [{ file: "src/a.css", search: "abc", replace: "", reason: "remove" }];
    expect(validateEdits(dir, edits, ["src/**"])).toEqual([]);
    expect(() => applyEdits(dir, edits, new Map([["src/a.css", "old"]]))).toThrow(/changed since/);
    expect(readFileSync(join(dir, "src/a.css"), "utf8")).toBe("abc");
    applyEdits(dir, edits);
    expect(readFileSync(join(dir, "src/a.css"), "utf8")).toBe("");
  });

  it("bounds a command that ignores SIGTERM", async () => {
    const command =
      process.platform === "win32"
        ? `"${process.execPath}" -e "setInterval(()=>{},1000)"`
        : `'${process.execPath}' -e 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'`;
    const result = await runCommand(command, temporary(), 200);
    expect(result).toMatchObject({ ok: false, timedOut: true });
  }, 5000);

  it("restores applied edits when a verification callback throws", async () => {
    const config = testConfig({ fix: { enabled: true, include: ["src/**"] } });
    mkdirSync(join(config.cwd, "src"));
    writeFileSync(join(config.cwd, "src/a.css"), "red");
    const result = await applyAndVerify(
      config,
      job(),
      config.cwd,
      [{ file: "src/a.css", search: "red", replace: "blue", reason: "repair" }],
      {
        /**
         * Deliberately throw from an observer to verify that callback failures do not break the
         * protected operation.
         */
        progress: () => {
          throw new Error("callback failed");
        },
      },
    );
    expect(result).toMatchObject({ kind: "failed" });
    expect(readFileSync(join(config.cwd, "src/a.css"), "utf8")).toBe("red");
  });
});

describe("AI request identity and accounting", () => {
  it("hashes every request field and image content, independent of object key order", () => {
    const request = {
      mode: "compare",
      settings: { thinking: "low" },
      parts: [{ data: Buffer.from("a") }],
    };
    expect(requestCacheKey(request)).toBe(
      requestCacheKey({ parts: request.parts, settings: request.settings, mode: request.mode }),
    );
    expect(requestCacheKey(request)).not.toBe(requestCacheKey({ ...request, mode: "baseline" }));
    expect(requestCacheKey(request)).not.toBe(
      requestCacheKey({ ...request, parts: [{ data: Buffer.from("b") }] }),
    );
  });

  it("ignores invalid and expired cached answers", () => {
    const dir = temporary();
    const cache = new AnalysisCache(dir, 1);
    writeFileSync(
      join(dir, "bad.json"),
      JSON.stringify({ version: 2, createdAt: Date.now(), value: { analysis: {}, usage: {} } }),
    );
    expect(cache.get("bad")).toBeUndefined();
    writeFileSync(
      join(dir, "old.json"),
      JSON.stringify({
        version: 2,
        createdAt: 1,
        value: { analysis: analysis("noise"), usage: { inputTokens: 1, outputTokens: 1 } },
      }),
    );
    expect(cache.get("old")).toBeUndefined();
  });

  it("charges schema repair attempts and retains usage when all answers are invalid", async () => {
    const budget = new AIBudget({ maxGenerationAttempts: 2 });
    const provider = budgetedProvider(new MockProvider(() => ({ value: "bad" })), budget);
    await expect(
      provider.generate({ system: "s", parts: [], schema: z.object({ value: z.number() }) }),
    ).rejects.toThrow(/invalid answer twice/);
    expect(budget.generationAttempts).toBe(2);
    expect(budget.usage.inputTokens).toBeGreaterThan(0);
    await expect(
      provider.generate({ system: "s", parts: [], schema: z.object({ value: z.number() }) }),
    ).rejects.toThrow(/budget reached/);
  });
});

describe("shard completeness", () => {
  /**
   * Write a controlled shard manifest into the supplied directory and return that directory.
   * The index/group parameters let merge tests construct compatible or conflicting inputs.
   */
  function shard(dir: string, index: number, group = "test"): string {
    mkdirSync(dir, { recursive: true });
    const manifest: RunManifest = {
      schemaVersion: 1,
      id: `run-${index}`,
      number: index,
      startedAt: new Date().toISOString(),
      durationMs: 1,
      mode: "compare",
      shard: { index, total: 2 },
      provenance: { group, fingerprint: "same", expectedJobs: ["a", "b"] },
      tool: { version: "1", node: "22" },
      config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
      summary: { pass: 1, accepted: 0, review: 0, regression: 0, error: 0 },
      jobs: [{ ...job(index === 1 ? "a" : "b"), status: "pass" }],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    return dir;
  }
  it("rejects incomplete inputs and marks an explicitly partial report", async () => {
    const config = testConfig({});
    const dir = shard(join(temporary(), "one"), 1);
    await expect(mergeRuns(config, [dir])).rejects.toThrow(/Incomplete/);
    const result = await mergeRuns(config, [dir], { allowPartial: true });
    expect(result.manifest.incomplete).toBe(true);
  });
  it("rejects a mixed group and duplicate shard", async () => {
    const config = testConfig({});
    const root = temporary();
    const one = shard(join(root, "one"), 1);
    const two = shard(join(root, "two"), 2, "other");
    await expect(mergeRuns(config, [one, two])).rejects.toThrow(/incompatible/);
    const duplicate = shard(join(root, "duplicate"), 1);
    await expect(mergeRuns(config, [one, duplicate])).rejects.toThrow(/Duplicate shard/);
  });
});
