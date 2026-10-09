/**
 * @file Runs labeled visual-diff evaluations and writes machine-readable and Markdown metric
 * reports.
 *
 * This is a repository-support script run by Node.js, outside the published package API.
 * Top-level await waits for setup before proceeding; async helpers return Promises. Read the
 * helpers below before invoking a script that starts processes or writes artifacts.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

// AI eval runner (PLAN.md §10.8). Runs VisualGuard over the labelled fixture pages and reports
// how well the classifications match the labels.
//
//   pnpm eval                                 heuristics only (no AI), the baseline
//   pnpm eval -- --provider gemini            needs GEMINI_API_KEY
//   pnpm eval -- --provider ollama --model qwen2.5vl
//
// Results are printed and saved to evals/results/.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createRun, parseConfig, resolveConfig } from "../packages/visualguard/dist/index.js";
import { evaluationCases, policyMetrics, calibrationMetrics } from "./metrics.mjs";
import { startFixtureServer } from "../scripts/fixture-server.mjs";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "none" },
    model: { type: "string" },
    viewports: { type: "string", default: "desktop,mobile" },
    cache: { type: "boolean", default: false },
    "min-regression-recall": { type: "string" },
    "min-regression-precision": { type: "string" },
    "all-ai": { type: "boolean", default: false },
  },
});

const root = resolve(import.meta.dirname);
const labels = JSON.parse(readFileSync(join(root, "labels.json"), "utf8"));
delete labels.$comment;
const CLASSES = ["regression", "intentional", "content", "noise"];
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

const production = await startFixtureServer("production");
const staging = await startFixtureServer("staging");
const outputDir = join(root, ".output");
rmSync(outputDir, { recursive: true, force: true });

try {
  for (const name of args.viewports.split(","))
    if (!VIEWPORTS[name]) throw new Error(`Unknown viewport: ${name}`);
  const viewports = Object.fromEntries(
    args.viewports.split(",").map((name) => [name, VIEWPORTS[name]]),
  );
  const config = resolveConfig(
    parseConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: Object.keys(labels),
      viewports,
      stabilize: { freezeTime: "2026-01-01T00:00:00Z" },
      ai: {
        provider: args.provider,
        model: args.model,
        analyze: args["all-ai"] ? "all" : "uncertain",
        maxCallsPerRun: 50,
        timeoutMs: 600_000,
      },
      output: { dir: outputDir },
      report: { html: true },
    }),
    { cwd: root, env: process.env },
  );
  const started = Date.now();
  const { manifest, runDir } = await createRun(config, { aiCache: args.cache }).start();

  const cases = evaluationCases(manifest, labels, Object.keys(viewports));
  const policy = policyMetrics(cases);
  const modelCases = cases.filter((c) => c.modelPredicted);
  const modelAccuracy = modelCases.length
    ? modelCases.filter((c) => c.label === c.modelPredicted).length / modelCases.length
    : null;

  const matrix = Object.fromEntries(
    CLASSES.map((actual) => [actual, Object.fromEntries([...CLASSES, "error"].map((p) => [p, 0]))]),
  );
  for (const item of cases) matrix[item.label][item.predicted]++;
  const perClass = Object.fromEntries(
    CLASSES.map((name) => {
      const tp = matrix[name][name];
      const predictedCount = CLASSES.reduce((sum, actual) => sum + matrix[actual][name], 0);
      const actualCount = [...CLASSES, "error"].reduce((sum, p) => sum + matrix[name][p], 0);
      return [
        name,
        {
          precision: predictedCount ? tp / predictedCount : null,
          recall: actualCount ? tp / actualCount : null,
          support: actualCount,
        },
      ];
    }),
  );
  const accuracy = cases.filter((item) => item.label === item.predicted).length / cases.length;
  const statusAccuracy =
    cases.filter((item) => item.status === item.expectedStatus).length / cases.length;

  /**
   * Format a fractional evaluation metric as a padded percentage for table output. Use a dash
   * for null so an unavailable score is distinct from zero.
   */
  const pct = (value) => (value === null ? "  –  " : `${(value * 100).toFixed(0).padStart(3)}%`);
  console.log(
    `\nVisualGuard evals · ${manifest.config.ai.provider}${manifest.config.ai.model ? ` (${manifest.config.ai.model})` : ""} · ${cases.length} cases · ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
  );
  console.log("  class         precision  recall  cases");
  for (const name of CLASSES) {
    const { precision, recall, support } = perClass[name];
    console.log(
      `  ${name.padEnd(12)}  ${pct(precision).padStart(9)}  ${pct(recall).padStart(6)}  ${String(support).padStart(5)}`,
    );
  }
  console.log(
    `\n  classification accuracy ${pct(accuracy)} · CI status accuracy ${pct(statusAccuracy)}\n`,
  );
  console.log("  confusion (rows = label, columns = predicted)");
  console.log(
    `  ${"".padEnd(12)}  ${CLASSES.map((name) => name.slice(0, 11).padStart(11)).join(" ")}`,
  );
  for (const actual of CLASSES) {
    console.log(
      `  ${actual.padEnd(12)}  ${CLASSES.map((p) => String(matrix[actual][p]).padStart(11)).join(" ")}`,
    );
  }
  const misses = cases.filter((item) => item.label !== item.predicted);
  if (misses.length > 0) {
    console.log("\n  misses");
    for (const item of misses) {
      console.log(
        `  ${item.route} ${item.viewport}: expected ${item.label}, got ${item.predicted} — ${item.title ?? ""}`,
      );
    }
  }

  const resultsDir = join(root, "results");
  mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${stamp}-${manifest.config.ai.provider}${manifest.config.ai.model ? `-${manifest.config.ai.model.replace(/[^a-z0-9.-]/gi, "_")}` : ""}.json`;
  writeFileSync(
    join(resultsDir, name),
    `${JSON.stringify({ datasetVersion: 2, promptVersion: "diff-v2", sampleSize: cases.length, calibration: calibrationMetrics(cases), policy, modelAccuracy, provider: manifest.config.ai, usage: manifest.usage, accuracy, statusAccuracy, perClass, matrix, cases }, null, 2)}\n`,
  );
  console.log(`\n  Saved evals/results/${name}`);
  console.log(`  Report ${join(runDir, "index.html")}\n`);
  console.log(
    "Hybrid policy metrics:",
    policy,
    "Model-only classification accuracy:",
    modelAccuracy,
  );
  for (const [flag, value] of [
    ["min-regression-recall", policy.regressionRecall],
    ["min-regression-precision", policy.regressionPrecision],
  ]) {
    if (args[flag] !== undefined) {
      const minimum = Number(args[flag]);
      if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1)
        throw new Error(`${flag} must be between 0 and 1`);
      if (value < minimum) {
        console.error(`${flag} gate failed: ${value} < ${minimum}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  await production.close();
  await staging.close();
}
