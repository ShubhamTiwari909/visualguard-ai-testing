/**
 * @file Tests JSON extraction/schema repair, analysis sessions, cache/policy behavior and patch
 * request preparation.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnalysisSession, needsAnalysis, statusWithAnalysis } from "../src/ai/analyze-job.js";
import { AIError, extractJSON, jsonSchemaFor } from "../src/ai/provider.js";
import { buildParts } from "../src/ai/tasks/analyze-diff.js";
import { createImage, writePNG } from "../src/diff/image.js";
import type { Finding, JobResult } from "../src/core/types.js";
import { analysis, MockProvider } from "./helpers/mock-provider.js";

describe("provider plumbing", () => {
  it("extracts JSON from fenced or chatty answers", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
    expect(extractJSON('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJSON('Sure! Here it is: {"a":3} Hope that helps.')).toEqual({ a: 3 });
    expect(() => extractJSON("no json here")).toThrow(/not JSON/);
  });

  it("turns zod schemas into JSON schemas without $schema", () => {
    const schema = jsonSchemaFor(z.object({ a: z.enum(["x", "y"]) }));
    expect(schema.$schema).toBeUndefined();
    expect(schema).toMatchObject({ type: "object", properties: { a: { enum: ["x", "y"] } } });
  });

  it("repairs one invalid answer, then gives up", async () => {
    const schema = z.object({ value: z.number() });
    const flaky = new MockProvider((request, call) =>
      call === 1 ? { value: "nope" } : { value: 42 },
    );
    await expect(flaky.generate({ system: "s", parts: [], schema })).resolves.toMatchObject({
      data: { value: 42 },
    });
    expect(flaky.requests[1]!.repair).toMatch(/value/);

    const broken = new MockProvider(() => "not json");
    await expect(broken.generate({ system: "s", parts: [], schema })).rejects.toBeInstanceOf(
      AIError,
    );
    expect(broken.requests).toHaveLength(2);
  });
});

describe("statusWithAnalysis (PLAN.md §10.5)", () => {
  const settings = { noiseConfidence: 0.8 };
  const hard: Finding[] = [{ severity: "regression", message: "Broken image", source: "health" }];

  it.each([
    ["review", [], "regression", 0.9, "regression"],
    ["review", [], "intentional", 0.9, "review"],
    ["review", [], "content", 0.9, "review"],
    ["review", [], "noise", 0.9, "pass"],
    ["review", [], "noise", 0.5, "review"],
    ["review", hard, "noise", 0.99, "regression"],
    ["regression", [], "intentional", 0.99, "regression"],
    ["error", [], "noise", 0.99, "error"],
  ] as const)("base %s + AI %s → …", (base, findings, classification, confidence, expected) => {
    expect(statusWithAnalysis(base, findings, { classification, confidence }, settings)).toBe(
      expected,
    );
  });
});

/**
 * Write small comparison crops into a temporary directory and return a job referencing them.
 * Real image files exercise prompt construction without browser or model traffic.
 */
function fixtureJob(): { job: JobResult; runDir: string } {
  const runDir = mkdtempSync(join(tmpdir(), "vg-ai-"));
  const crops = { production: "p.png", staging: "s.png", diff: "d.png" };
  for (const file of Object.values(crops))
    writePNG(join(runDir, file), createImage(40, 20, [255, 255, 255, 255]));
  const job: JobResult = {
    id: "pricing__desktop",
    route: "/pricing",
    name: "/pricing",
    viewport: "desktop",
    status: "review",
    baseStatus: "review",
    urls: { production: "https://a.test/pricing", staging: "https://b.test/pricing" },
    captures: {},
    diff: { width: 100, height: 100, diffPixels: 500, diffRatio: 0.05 },
    regions: [
      {
        id: 0,
        box: { x: 0, y: 0, width: 40, height: 20 },
        diffPixels: 500,
        crops,
        elements: [{ selector: "a.btn", tag: "a", text: "Buy" }],
        deltas: [
          {
            kind: "style",
            selector: "a.btn",
            property: "color",
            production: "rgb(0, 0, 0)",
            staging: "rgb(255, 0, 0)",
          },
        ],
        heuristic: "Colour changed",
      },
    ],
    durationMs: 1,
  };
  return { job, runDir };
}

describe("AnalysisSession", () => {
  const settings = { maxRegionsPerJob: 3, noiseConfidence: 0.8, maxCallsPerRun: 2 };

  it("applies the analysis, drops unknown selectors and caches the answer", async () => {
    const { job, runDir } = fixtureJob();
    const provider = new MockProvider(() =>
      analysis("regression", { affected: [{ selector: "a.btn" }, { selector: "div.invented" }] }),
    );
    const cacheDir = join(runDir, "cache");
    const first = await new AnalysisSession(provider, settings, { cacheDir }).analyze(
      job,
      runDir,
      "compare",
    );
    expect(first.status).toBe("regression");
    expect(first.analysis).toMatchObject({
      classification: "regression",
      provider: "mock",
      cached: false,
    });
    expect(first.analysis!.affected).toEqual([{ selector: "a.btn" }]);

    const second = await new AnalysisSession(provider, settings, { cacheDir }).analyze(
      job,
      runDir,
      "compare",
    );
    expect(second.analysis!.cached).toBe(true);
    expect(provider.requests).toHaveLength(1);
  });

  it("falls back to the heuristic status when the call fails or the budget is spent", async () => {
    const { job, runDir } = fixtureJob();
    const failing = await new AnalysisSession(
      new MockProvider(() => new AIError("quota")),
      settings,
    ).analyze(job, runDir, "compare");
    expect(failing.status).toBe("review");
    expect(failing.findings!.at(-1)!.message).toBe("AI analysis failed: quota");

    const session = new AnalysisSession(new MockProvider(() => analysis("noise")), {
      ...settings,
      maxCallsPerRun: 0,
    });
    const skipped = await session.analyze(job, runDir, "compare");
    expect(skipped.findings!.at(-1)!.message).toMatch(/AI budget reached/);
  });

  it("stops calling the provider after a quota or key error", async () => {
    const { job, runDir } = fixtureJob();
    const provider = new MockProvider(
      () => new AIError("Gemini quota used up; it resets in 17h 39m", { stopsRun: true }),
    );
    const session = new AnalysisSession(provider, { ...settings, maxCallsPerRun: 10 });
    const first = await session.analyze(job, runDir, "compare");
    const second = await session.analyze(job, runDir, "compare");
    expect(first.findings!.at(-1)!.message).toMatch(/AI analysis failed: Gemini quota used up/);
    expect(second.findings!.at(-1)!.message).toBe(
      "AI skipped: Gemini quota used up; it resets in 17h 39m",
    );
    expect(second.status).toBe("review");
    expect(provider.requests).toHaveLength(1);
  });

  it("skips jobs the heuristics already marked as regressions unless asked for all", () => {
    const { job } = fixtureJob();
    const regression = { ...job, status: "regression" as const, baseStatus: "regression" as const };
    expect(needsAnalysis(regression, "uncertain")).toBe(false);
    expect(needsAnalysis(regression, "all")).toBe(true);
    expect(needsAnalysis(job, "uncertain")).toBe(true);
  });

  it("re-analysis starts from the base status, not the previous AI status", async () => {
    const { job, runDir } = fixtureJob();
    const asRegression = await new AnalysisSession(
      new MockProvider(() => analysis("regression")),
      settings,
    ).analyze(job, runDir, "compare");
    const asNoise = await new AnalysisSession(
      new MockProvider(() => analysis("noise")),
      settings,
    ).analyze(asRegression, runDir, "compare");
    expect(asNoise.status).toBe("pass");
    expect(needsAnalysis(asNoise)).toBe(true);
  });
});

describe("buildParts", () => {
  it("sends three images per region to capable models and one composite to small ones", () => {
    const { job, runDir } = fixtureJob();
    const input = {
      job,
      runDir,
      mode: "compare" as const,
      maxRegions: 3,
      knownSelectors: new Set<string>(),
    };
    /**
     * Build prompt parts for a mock provider with a chosen image limit and keep only image
     * parts. This makes the test assert provider-capability behavior directly.
     */
    const images = (maxImages: number) =>
      buildParts(new MockProvider(() => ({}), maxImages), input).filter(
        (part) => part.type === "image",
      );
    expect(images(16)).toHaveLength(3);
    const composite = images(1);
    expect(composite).toHaveLength(1);
    const text = buildParts(new MockProvider(() => ({})), input)
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    expect(text).toContain("Route: /pricing   Viewport: desktop");
    expect(text).toContain("a.btn  color: #000000 → #ff0000");
  });
});
