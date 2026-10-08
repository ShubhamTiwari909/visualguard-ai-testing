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
import { startFixtureServer } from "../scripts/fixture-server.mjs";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "none" },
    model: { type: "string" },
    viewports: { type: "string", default: "desktop,mobile" },
    cache: { type: "boolean", default: false },
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

const labelFor = (route, viewport) =>
  typeof labels[route] === "string" ? labels[route] : labels[route]?.[viewport];

/** Without AI, statuses stand in for classes: regression → regression, pass → noise, review → intentional. */
const predicted = (job) =>
  job.analysis?.classification ??
  (job.status === "regression" ? "regression" : job.status === "pass" ? "noise" : "intentional");
const expectedStatus = (label) =>
  label === "regression" ? "regression" : label === "noise" ? "pass" : "review";

const production = await startFixtureServer("production");
const staging = await startFixtureServer("staging");
const outputDir = join(root, ".output");
rmSync(outputDir, { recursive: true, force: true });

try {
  const viewports = Object.fromEntries(
    args.viewports.split(",").map((name) => [name, VIEWPORTS[name]]),
  );
  const config = resolveConfig(
    parseConfig({
      baseURL: { production: production.url, staging: staging.url },
      routes: Object.keys(labels),
      viewports,
      stabilize: { freezeTime: "2026-01-01T00:00:00Z" },
      ai: { provider: args.provider, model: args.model },
      output: { dir: outputDir },
      report: { html: true },
    }),
    { cwd: root, env: process.env },
  );
  const started = Date.now();
  const { manifest, runDir } = await createRun(config, { aiCache: args.cache }).start();

  const cases = [];
  for (const job of manifest.jobs) {
    const label = labelFor(job.route, job.viewport);
    if (!label) continue;
    // Pages that didn't differ at this viewport aren't cases (e.g. overflow on desktop).
    if ((job.baseStatus ?? job.status) === "pass" && label !== "noise") continue;
    cases.push({
      route: job.route,
      viewport: job.viewport,
      label,
      predicted: predicted(job),
      status: job.status,
      expectedStatus: expectedStatus(label),
      confidence: job.analysis?.confidence,
      title: job.analysis?.title ?? job.findings?.[0]?.message,
    });
  }

  const matrix = Object.fromEntries(
    CLASSES.map((actual) => [actual, Object.fromEntries(CLASSES.map((p) => [p, 0]))]),
  );
  for (const item of cases) matrix[item.label][item.predicted]++;
  const perClass = Object.fromEntries(
    CLASSES.map((name) => {
      const tp = matrix[name][name];
      const predictedCount = CLASSES.reduce((sum, actual) => sum + matrix[actual][name], 0);
      const actualCount = CLASSES.reduce((sum, p) => sum + matrix[name][p], 0);
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
    `${JSON.stringify({ provider: manifest.config.ai, usage: manifest.usage, accuracy, statusAccuracy, perClass, matrix, cases }, null, 2)}\n`,
  );
  console.log(`\n  Saved evals/results/${name}`);
  console.log(`  Report ${join(runDir, "index.html")}\n`);
} finally {
  await production.close();
  await staging.close();
}
