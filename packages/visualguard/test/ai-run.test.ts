/**
 * @file Tests AI integration with capture runs, status guards, analysis scope, manifest usage
 * and saved-run reanalysis.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reanalyzeRun } from "../src/cli/commands/analyze.js";
import { createRun } from "../src/core/run.js";
import { readManifest } from "../src/core/runs.js";
import type { RunManifest } from "../src/core/types.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";
import { analysis, MockProvider } from "./helpers/mock-provider.js";

let production: FixtureServer;
let staging: FixtureServer;

beforeAll(async () => {
  production = await startFixtureServer("production");
  staging = await startFixtureServer("staging");
});
afterAll(async () => {
  await production?.close();
  await staging?.close();
});

/**
 * The model's verdict per route, keyed off the route in the prompt.
 */
const verdicts: Record<string, string> = {
  "/alignment": "regression",
  "/text-change": "intentional",
  "/spacing": "noise",
  "/missing-image": "noise",
};
/**
 * Create a mock model whose response is selected by the route text in its prompt. No cloud
 * request is made, so these policy assertions are deterministic.
 */
const provider = () =>
  new MockProvider((request) => {
    const prompt = request.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    const route = prompt.match(/Route: (\S+)/)?.[1] ?? "";
    return analysis(verdicts[route] ?? "intentional", {
      title: `AI says ${verdicts[route]} on ${route}`,
    });
  });

describe("test with AI", () => {
  let manifest: RunManifest;
  let runDir: string;
  let config: ReturnType<typeof testConfig>;

  beforeAll(async () => {
    config = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/identical", "/alignment", "/text-change", "/spacing", "/missing-image"],
      // Analyze the known regression too, to check the model can't downgrade it.
      ai: { analyze: "all" },
    });
    ({ manifest, runDir } = await createRun(config, { ai: provider() }).start());
  }, 120_000);

  /**
   * Find the named route in the original run manifest. The non-null assertion expresses that
   * the test fixture is expected to contain that route.
   */
  const job = (route: string) => manifest.jobs.find((candidate) => candidate.route === route)!;

  it("lets the model raise, keep or lower heuristic statuses", () => {
    expect(job("/identical").analysis).toBeUndefined();
    expect(job("/alignment")).toMatchObject({ baseStatus: "review", status: "regression" });
    expect(job("/text-change")).toMatchObject({ baseStatus: "review", status: "review" });
    expect(job("/spacing")).toMatchObject({ baseStatus: "review", status: "pass" });
  });

  it("never downgrades a hard failure", () => {
    expect(job("/missing-image").analysis?.classification).toBe("noise");
    expect(job("/missing-image").status).toBe("regression");
  });

  it("by default skips pages the heuristics already marked as regressions", async () => {
    const defaults = testConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: ["/alignment", "/missing-image"],
    });
    const { manifest: run } = await createRun(defaults, { ai: provider() }).start();
    const missing = run.jobs.find((candidate) => candidate.route === "/missing-image")!;
    expect(missing.status).toBe("regression");
    expect(missing.analysis).toBeUndefined();
    expect(run.usage!.aiCalls).toBe(1);
  }, 120_000);

  it("records provider, model and usage in the manifest", () => {
    expect(manifest.config.ai).toEqual({ provider: "mock", model: "mock-1" });
    expect(manifest.usage).toMatchObject({
      aiCalls: 4,
      inputTokens: 400,
      outputTokens: 80,
      generationAttempts: 4,
      networkAttempts: 0,
    });
  });

  it("`analyze` re-runs the model on an existing run from the base statuses", async () => {
    verdicts["/alignment"] = "intentional";
    const result = await reanalyzeRun(config, {
      provider: provider(),
      runId: manifest.id,
      useCache: false,
    });
    expect(result.analyzed).toBe(4);
    /**
     * Find the same route in the reanalyzed manifest. Comparing it with the original job
     * verifies what analysis changed.
     */
    const updated = (route: string) =>
      result.manifest.jobs.find((candidate) => candidate.route === route)!;
    expect(updated("/alignment")).toMatchObject({ baseStatus: "review", status: "review" });
    expect(updated("/missing-image").status).toBe("regression");
    expect(result.manifest.usage!.aiCalls).toBe(8);

    // Manifest, run index and report on disk are updated.
    expect(
      readManifest(runDir).jobs.find((candidate) => candidate.route === "/alignment")!.status,
    ).toBe("review");
    expect(readFileSync(join(runDir, "index.html"), "utf8")).toContain(
      "AI says intentional on /alignment",
    );
  });
});
