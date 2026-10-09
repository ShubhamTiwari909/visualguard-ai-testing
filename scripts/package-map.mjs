/**
 * @file Regenerates the Markdown architecture guide, package file inventory and file
 * connections.
 *
 * This is a repository-support script run by Node.js, outside the published package API.
 * Top-level await waits for setup before proceeding; async helpers return Promises. Read the
 * helpers below before invoking a script that starts processes or writes artifacts.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

// Rebuild the documented package inventory and file connections without executing package code.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "packages/visualguard");
const docsRoot = resolve(root, "docs");
const guidePath = resolve(docsRoot, "PACKAGE-ARCHITECTURE.md");
const formatOptions = (await resolveConfig(guidePath)) ?? {};
/**
 * Normalize Windows path separators to forward slashes for portable inventory paths and Markdown
 * links. This changes only the path text used in documentation.
 */
const slash = (value) => value.split("\\").join("/");
const roles = {
  "package.json":
    "Declares npm CLI/API exports, version, published files, dependencies and build/test scripts.",
  "README.md": "Package-level usage documentation; no executable code.",
  "CHANGELOG.md": "Records published package changes; no executable code.",
  LICENSE: "MIT license text; no executable code.",
  "tsconfig.json": "TypeScript compiler configuration for the Node package source and tests.",
  "tsup.config.ts":
    "Bundles API, CLI, Playwright fixture and diff worker; emits public declarations and injects the version.",
  "vitest.config.ts":
    "Selects Vitest suites, test timeouts, report global setup and compile-time version replacement.",
  "src/index.ts":
    "Public API barrel: exports configuration/run/status helpers, reporters and types; does not start a run.",
  "src/globals.d.ts":
    "Declares the build-injected version constant for TypeScript; erased at runtime.",
  "src/cli/main.ts":
    "Executable CLI entry: parses arguments, catches command errors and assigns process exit codes.",
  "src/cli/program.ts":
    "Creates the Commander program and registers every subcommand plus positional URL mode.",
  "src/cli/shared.ts":
    "Loads/resolves config, maps CLI options, selects standard reporters and formats common errors.",
  "src/cli/commands/test.ts":
    "Implements configured comparisons/baselines, capture flags, planned-job listing and failure exits.",
  "src/cli/commands/zero-config.ts":
    "Splits positional URLs into routes; orchestrates single-site scans or two-site comparisons.",
  "src/cli/commands/init.ts":
    "Interactive/noninteractive setup: discovers project routes and writes config, env and optional workflow files.",
  "src/cli/commands/doctor.ts":
    "Runs environment/config/browser/URL diagnostics and prints actionable setup results.",
  "src/cli/commands/auth.ts":
    "Opens an authenticated browser workflow and persists an environment's storage state.",
  "src/cli/commands/report.ts":
    "Opens/serves saved reports and binds accept/propose/apply API handlers, proposal freshness and apply locking.",
  "src/cli/commands/analyze.ts":
    "Re-analyzes saved run artifacts, restores accumulated usage and updates the manifest/report.",
  "src/cli/commands/accept.ts":
    "Records intentional screenshot/change fingerprints and reapplies acceptance without waiving health findings.",
  "src/cli/commands/comment.ts":
    "Finds the associated GitHub PR and posts/updates a sticky Markdown run-summary comment.",
  "src/cli/commands/fix.ts":
    "CLI repair prompts, source-upload consent and progress; dispatches interactive or automatic fixing.",
  "src/cli/commands/watch.ts":
    "Watches source files, traces page import relationships and re-runs affected routes against a dev server.",
  "src/cli/commands/monitor.ts":
    "Compares a site with prior captures, rolls eligible references forward, or generates a scheduled workflow.",
  "src/cli/commands/merge.ts":
    "CLI wrapper for shard merge, reporting and incomplete/failing exit policy.",
  "src/config/schema.ts":
    "Zod configuration schemas/defaults and hook/route/viewport types; validates every configuration group.",
  "src/config/load.ts":
    "Finds/imports config, loads env files, rejects literal keys and reports schema validation errors.",
  "src/config/resolve.ts":
    "Resolves CLI > environment > config precedence and absolute output paths; validates selected settings.",
  "src/config/routes.ts":
    "Combines discovery sources/extra routes, expands dynamic parameters and filters the route plan.",
  "src/config/urls.ts":
    "Normalizes/joins base URLs, expands dynamic segments and creates safe slugs/stable short hashes.",
  "src/config/glob.ts":
    "Converts supported glob syntax to regular expressions for route and source filtering.",
  "src/config/discover/nextjs.ts":
    "Reads Next.js App/Pages Router files, accounting for routing conventions, to discover page paths.",
  "src/config/discover/web.ts":
    "Reads sitemap/robots URLs and crawls same-site links within configured scope/depth.",
  "src/core/run.ts":
    "Central orchestrator: plans jobs, captures references/current pages, diffs/classifies/analyzes/accepts results, emits events and saves runs.",
  "src/core/jobs.ts":
    "Builds uniquely identified route × viewport jobs with per-environment URLs, waits, masks and hides.",
  "src/core/comparison.ts":
    "Shared CLI/fixture classification: loads DOM evidence and combines visual classification with independent check findings.",
  "src/core/findings.ts":
    "Converts health/accessibility/performance changes into findings and raises result severity without downgrading failures.",
  "src/core/accepted.ts":
    "Reads/writes accepted changes, hashes screenshots and compares exact/similar change fingerprints with health guards.",
  "src/core/provenance.ts":
    "Canonical hashes, Git revision, capture-policy snapshots and baseline rendering metadata/compatibility checks.",
  "src/core/merge.ts":
    "Discovers shard manifests, validates shared identity/full coverage and copies artifacts into one merged run.",
  "src/core/runs.ts":
    "Creates numbered run directories, maintains the run index/retention, and reads/writes manifests.",
  "src/core/reachability.ts":
    "Performs an upfront base-URL reachability check and returns environment diagnostics.",
  "src/core/status.ts":
    "Counts statuses and translates failure policy/incomplete results to failing process exit codes.",
  "src/core/events.ts":
    "Typed run-event definitions and emitter used to notify reporters/listeners.",
  "src/core/types.ts":
    "Shared data contracts for jobs, captures, health, pixel regions, DOM deltas, AI analysis and manifests; type-only.",
  "src/core/errors.ts":
    "Defines categorized usage/environment errors, exit codes and readable error messages.",
  "src/core/util.ts":
    "Small shared helpers for timeouts, durations, pluralization and PNG dimensions.",
  "src/core/version.ts": "Exposes the package version injected by the bundler.",
  "src/capture/browser.ts":
    "Loads Playwright lazily, launches the selected engine and creates isolated contexts with auth/render/network settings.",
  "src/capture/capture.ts":
    "Runs one page capture: instrument, navigate, prepare/stabilize, retry, screenshot, gather DOM/health/checks and traces.",
  "src/capture/stabilize.ts":
    "Browser-side stability helpers: CSS, network tracking, fonts, lazy-load scrolling, image readiness and media/page metrics.",
  "src/capture/health.ts":
    "Attaches console/page-error/request listeners to a page and exposes cleanup for collected signals.",
  "src/capture/checks.ts":
    "Injects/runs axe accessibility checks and preserves/reads browser performance timing/resource metrics.",
  "src/capture/dom-snapshot.ts":
    "Serializes relevant visible DOM structure, selectors, text, computed styles and bounding boxes for later explanation.",
  "src/diff/runner.ts":
    "Chooses inline diffing in source runs or queues CPU work in a pool of built worker threads.",
  "src/diff/worker.ts":
    "Worker entry: receives image-diff tasks, calls computeDiff and sends results/errors to the parent thread.",
  "src/diff/compute.ts":
    "Complete image job: pad sizes, compare pixels, remove noise, enforce tolerances, detect shifts and write diff/crop artifacts.",
  "src/diff/compare.ts": "Pixelmatch engine adapter plus rendering of the visual difference image.",
  "src/diff/image.ts":
    "PNG decode/encode/file I/O and RGBA image creation, padding and crop helpers.",
  "src/diff/noise.ts":
    "Builds changing-area masks from repeat captures, aligns them to DOM boxes and clears ignored pixels.",
  "src/diff/regions.ts":
    "Groups changed pixel cells into nearby/merged bounding regions and limits/sorts the result.",
  "src/diff/shift.ts":
    "Hashes image rows to detect vertical insertion/removal shifts and computes a residual diff after alignment.",
  "src/mapping/dom.ts":
    "Indexes DOM nodes, resolves labels/ancestry and provides geometry intersection/area/shift operations.",
  "src/mapping/match.ts":
    "Matches production and staging DOM trees, including stable keys, sibling changes and moved elements.",
  "src/mapping/deltas.ts":
    "Maps a pixel region to matched elements and generates style, text, box and presence deltas.",
  "src/mapping/describe.ts":
    "Turns DOM deltas into concise explanations such as changed colour, spacing, text or alignment.",
  "src/mapping/contrast.ts":
    "Parses colours and computes effective backgrounds and text contrast ratios for readability findings.",
  "src/mapping/classify.ts":
    "Deterministic visual classifier: explains regions, finds removed controls/readability/overlap problems and filters tiny noise.",
  "src/ai/provider.ts":
    "Provider contract and structured-output base implementation; extracts/validates JSON, repairs invalid answers and records usage.",
  "src/ai/factory.ts":
    "Chooses Gemini/Ollama/no provider from config/env and reports missing-credential fallback.",
  "src/ai/providers/gemini.ts":
    "Gemini SDK transport: image/schema requests, thinking/detail settings, retry/quota handling and returned model/token metadata.",
  "src/ai/providers/ollama.ts":
    "Ollama HTTP transport for multimodal structured generation, local model settings, timeouts and cancellation.",
  "src/ai/images.ts":
    "Prepares/resizes/composites PNG images for provider image limits and request payloads.",
  "src/ai/tasks/analyze-diff.ts":
    "Defines analysis prompt/schema, selects regions, builds trusted/untrusted context and validates visual classifications/selectors.",
  "src/ai/tasks/generate-patch.ts":
    "Defines patch prompt/schema and builds requests from screenshot/DOM evidence, source excerpts and retry feedback.",
  "src/ai/analyze-job.ts":
    "Per-run/test analysis session: request caching, budget/provider fallback and guarded application of AI status changes.",
  "src/ai/cache.ts":
    "Hashes prepared requests and stores/reads versioned, validated, expiring analysis cache records.",
  "src/ai/budget.ts":
    "Shared generation/network/token/deadline ledger, provider wrapping and cumulative saved run-usage persistence.",
  "src/fixer/files.ts":
    "Enumerates eligible source files with protected paths/extensions, size/count limits and skipped build/dependency directories.",
  "src/fixer/git.ts":
    "Git subprocess helpers for repository root, dirty paths and files changed since a ref.",
  "src/fixer/locate.ts":
    "Collects DOM/source clues, follows page imports, ranks candidate files and selects source excerpts.",
  "src/fixer/heuristic-edits.ts":
    "Produces deterministic search/replace repairs for unambiguous class-list and CSS-value changes.",
  "src/fixer/edits.ts":
    "Validates/previews/renders edits, checks original contents, applies multi-file changes and rolls back failures.",
  "src/fixer/fix.ts":
    "Repair coordinator: choose jobs, obtain proposals/consent, confirm/apply/verify/retry, record artifacts and verify final batch scope.",
  "src/fixer/verify.ts":
    "Runs bounded verification commands, manages the dev-server process and compares new captures with immutable saved references.",
  "src/fixer/auto.ts":
    "Automatic Git workflow: enforce visual verification, create isolated worktree/branch, commit verified edits and optionally push/open PR.",
  "src/playwright/index.ts":
    "Playwright fixture entry: extends test/page, loads config, checks interactive state against production/baselines and attaches evidence.",
  "src/reporters/terminal.ts":
    "Human-readable progress, statuses, findings and AI/usage output for the terminal.",
  "src/reporters/json.ts": "Reporter that prints the final manifest as JSON.",
  "src/reporters/html.ts":
    "Loads the prebuilt React report, embeds JS/CSS plus escaped manifest data and writes per-run HTML.",
  "src/reporters/markdown.ts":
    "Escapes/formats Markdown run summaries and detailed findings for comments/job summaries.",
  "src/reporters/ci.ts": "JUnit XML, GitHub job summary and webhook reporter implementations.",
  "src/reporters/github-comment.ts":
    "GitHub context/REST helpers for PR lookup, sticky comment updates and PR creation.",
  "src/server/report-server.ts":
    "Local artifact server: renders current manifest data and dispatches token-protected POST action handlers.",
  "src/setup/project.ts":
    "Detects framework/package manager and updates gitignore, package scripts/env files; suggests install/exec commands.",
  "src/setup/config-template.ts":
    "Renders typed VisualGuard config from setup answers and viewport/provider choices.",
  "src/setup/workflow-template.ts":
    "Renders comparison and scheduled monitor GitHub workflow YAML.",
  "report-app/index.html":
    "Report HTML shell with root element, data-injection placeholder and browser module entry.",
  "report-app/tsconfig.json":
    "TypeScript configuration for React report source and shared global declarations.",
  "report-app/vite.config.ts":
    "Builds React/Tailwind assets under dist/report-app in the layout expected by the HTML reporter.",
  "report-app/src/main.tsx":
    "Browser entry: reads embedded report data and mounts the React App or a missing-data message.",
  "report-app/src/App.tsx":
    "Report shell: search/status filtering, selected job, navigation/hash state, themes, incomplete banner and usage summary.",
  "report-app/src/JobDetail.tsx":
    "Selected job's capture/region/DOM/finding/AI/health details and connections to comparison views and actions.",
  "report-app/src/Compare.tsx":
    "Screenshot comparison modes: side by side, slider, onion-skin overlay, diff, zoom and region display.",
  "report-app/src/actions.tsx":
    "Accept/fix UI; calls local token-protected APIs, previews proposal diffs and displays apply/verification results.",
  "report-app/src/data.ts":
    "Browser report data contracts, injected-data access, formatting/sorting and URL hash state; imports shared types only.",
  "report-app/src/ui.tsx":
    "Reusable report controls: status badges/icons, pills, sections, keyboard hints, segmented controls and copy actions.",
  "report-app/src/styles.css":
    "Tailwind/report styling, theme and comparison/application appearance.",
  "test/global-setup.ts":
    "Builds the report app once before Vitest suites that load the real HTML bundle.",
  "test/helpers/config.ts":
    "Creates isolated temporary test configurations and output directories.",
  "test/helpers/dom.ts":
    "Constructs synthetic DOM snapshots/nodes used in matching and classification tests.",
  "test/helpers/fixture-server.ts":
    "Serves production/staging fixture pages and returns server lifecycle helpers.",
  "test/helpers/mock-provider.ts":
    "Mock structured AI provider, canned analysis responses and usage for deterministic tests.",
  "test/helpers/static-site-server.mjs":
    "Child-process static site server whose files can be edited during repair/verification tests.",
  "test/pw/global-setup.ts":
    "Starts/stops fixture production/staging servers for the nested Playwright runner.",
  "test/pw/playwright.config.ts":
    "Selects fixture specs, global setup, one worker, viewport and report/output settings.",
  "test/pw/fixture.spec.ts":
    "Real Playwright tests for passing/failing checkpoints, baselines, referenceSetup and early health collection.",
  "test/accepted.test.ts":
    "Tests stored exact/similar acceptance, changed fingerprints, legacy entries and health protections.",
  "test/ai-run.test.ts":
    "Tests AI integration with capture runs, status guards, analysis scope, manifest usage and saved-run reanalysis.",
  "test/ai.test.ts":
    "Tests JSON extraction/schema repair, analysis sessions, cache/policy behavior and patch request preparation.",
  "test/auto-fix.test.ts":
    "Tests automatic fixing in temporary repositories/worktrees with a simulated PR API and verified Git outcomes.",
  "test/baseline.test.ts":
    "Tests explicit baseline creation/update and comparison with saved references.",
  "test/browser-smoke.test.ts":
    "Smoke-tests an identical fixture in the selected Chromium/Firefox/WebKit engine.",
  "test/checks.test.ts":
    "Tests configured accessibility/performance capture and threshold-based independent findings.",
  "test/ci.test.ts":
    "Tests acceptance/report APIs, escaped Markdown, JUnit, webhook/job summary and GitHub integration output.",
  "test/cli.test.ts": "Tests CLI version and subcommand option routing.",
  "test/config.test.ts":
    "Tests schema/defaults/invalid secrets, overrides/env precedence and config loading.",
  "test/diff.test.ts":
    "Tests complete image comparisons, size padding, thresholds and written diff/region artifacts.",
  "test/discovery.test.ts":
    "Tests Next.js route conventions, base-path URLs, sitemap/robots and web crawling.",
  "test/explanations.test.ts":
    "Tests end-to-end human explanations for text, colour, layout/spacing and deterministic failures.",
  "test/findings.test.ts":
    "Tests differential health findings, scan policy and severity escalation.",
  "test/fixer.test.ts":
    "Tests edits, deterministic CSS/class repairs, source location, command/server checks and interactive fixing.",
  "test/integration.test.ts":
    "Tests capture pipeline/statuses, errors, retention, dynamic content and deterministic stability on fixture pages.",
  "test/mapping.test.ts":
    "Tests DOM tree matching, moved/keyed elements, inherited styles and region-to-delta explanations.",
  "test/nextjs-example.test.ts":
    "Opt-in real Next.js build/dev test: seeds three regressions and verifies repairs; skipped without VG_E2E_NEXT.",
  "test/noise.test.ts":
    "Tests noise area snapping/limits and conservative handling of oversized DOM containers.",
  "test/playwright-fixture.test.ts":
    "Builds the fixture entry and launches the nested Playwright suite to verify real public imports.",
  "test/providers.test.ts":
    "Tests Gemini/Ollama transport shape, retries, settings fallback, quota handling and usage with mocked services.",
  "test/regions.test.ts":
    "Tests changed-cell region extraction, sorting, transitive merging and caps.",
  "test/reliability.test.ts":
    "Tests F01-F12 invariants: acceptance/AI guards, baseline identity, eval denominator, budgets/cache, stale edits and shards.",
  "test/report-fix.test.ts":
    "Browser-tests the served report's propose → confirm → apply/verify repair flow.",
  "test/report.test.ts":
    "Tests static/served report rendering, embedded-data safety, screenshot loading, navigation and accessibility.",
  "test/setup.test.ts":
    "Tests project detection, idempotent setup edits, generated config/init and doctor diagnostics.",
  "test/shard-monitor.test.ts":
    "Tests deterministic sharding/merge and production-monitor rolling references/generated schedule.",
  "test/shift.test.ts":
    "Tests inserted/removed vertical layout bands and cases without a meaningful shift.",
  "test/transaction.test.ts":
    "Simulates failure during a multi-file write and verifies restoration of already-written files.",
  "test/urls.test.ts":
    "Tests URL joining/validation and single/catch-all/optional dynamic route parameter expansion.",
  "test/verification.test.ts":
    "Tests immutable references when production is offline and rollback of collateral viewport damage.",
  "test/zero-config.test.ts":
    "Tests positional URL routing and first/subsequent single-site snapshot scans.",
};

const entries = {
  "src/cli/main.ts": "CLI executable → dist/cli.js",
  "src/index.ts": "npm import visualguard → dist/index.js",
  "src/playwright/index.ts": "npm import visualguard/playwright → dist/playwright.js",
  "src/diff/worker.ts": "worker-thread entry → dist/diff-worker.js",
  "report-app/src/main.tsx": "report browser entry → dist/report-app/assets/app.js",
};
const rawFiles = execFileSync("rg", ["--files", "packages/visualguard"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .sort();
const absoluteFiles = new Set(rawFiles.map((file) => resolve(root, file)));
const records = rawFiles.map((file) => {
  const id = slash(relative(packageRoot, resolve(root, file)));
  if (!roles[id]) throw new Error(`Missing file description: ${id}`);
  return { id, role: roles[id], entry: entries[id], exports: [], dependencies: [], importedBy: [] };
});
const byId = new Map(records.map((record) => [record.id, record]));
const edges = [];
/**
 * Resolve a supported import to an inventoried source file, including package self-imports and
 * .js-to-.ts source mappings. Return undefined for external or unresolved imports so the guide
 * can distinguish them.
 */
function resolveModule(from, specifier) {
  if (specifier === "visualguard") return "src/index.ts";
  if (specifier === "visualguard/playwright") return "src/playwright/index.ts";
  if (!specifier.startsWith(".")) return undefined;
  const candidate = resolve(packageRoot, dirname(from), specifier);
  const bare = candidate.replace(/\.[cm]?js$/, "");
  for (const name of [
    candidate,
    bare + ".ts",
    bare + ".tsx",
    bare + ".mts",
    candidate + ".ts",
    candidate + ".tsx",
    resolve(candidate, "index.ts"),
  ]) {
    if (absoluteFiles.has(name)) return slash(relative(packageRoot, name));
  }
  return undefined;
}
/**
 * Record a unique dependency and its reverse imported-by edge. The shared key prevents
 * duplicate syntax references from duplicating connection entries.
 */
function connect(from, specifier, kind, line) {
  const to = resolveModule(from, specifier);
  const edge = { from, to, specifier, kind, line };
  const key = JSON.stringify([from, to, specifier, kind]);
  if (edges.some((other) => other.key === key)) return;
  edges.push({ ...edge, key });
  byId.get(from).dependencies.push(edge);
  if (to) byId.get(to).importedBy.push({ from, kind, line });
}
for (const record of records) {
  if (!/\.(ts|tsx|mts|mjs)$/.test(record.id)) continue;
  const text = readFileSync(resolve(packageRoot, record.id), "utf8");
  const source = ts.createSourceFile(record.id, text, ts.ScriptTarget.Latest, true);
  /**
   * Walk TypeScript syntax nodes to collect imports, re-exports and declared exports without
   * executing source. Record source line numbers so the generated guide can link to the import
   * location.
   */
  const visit = (node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const allType =
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly);
        connect(
          record.id,
          node.moduleSpecifier.text,
          node.isTypeOnly || clause?.isTypeOnly || (!clause?.name && allType)
            ? "type"
            : ts.isExportDeclaration(node)
              ? "re-export"
              : "import",
          line,
        );
      }
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause))
        record.exports.push(...node.exportClause.elements.map((element) => element.name.text));
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        connect(record.id, node.arguments[0].text, "dynamic-import", line);
      if (ts.isIdentifier(node.expression) && node.expression.text === "require")
        connect(record.id, node.arguments[0].text, "require", line);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      connect(record.id, node.argument.literal.text, "type", line);
    if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name) record.exports.push(node.name.text);
      if (ts.isVariableStatement(node))
        for (const declaration of node.declarationList.declarations)
          if (ts.isIdentifier(declaration.name)) record.exports.push(declaration.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  record.exports = [...new Set(record.exports)].sort();
}
const supplements = [
  ["package.json", "src/cli/main.ts", "entry", "bin → dist/cli.js"],
  ["package.json", "src/index.ts", "entry", "exports . → dist/index.js"],
  ["package.json", "src/playwright/index.ts", "entry", "exports ./playwright"],
  ["tsup.config.ts", "src/index.ts", "build", "API bundle"],
  ["tsup.config.ts", "src/cli/main.ts", "build", "CLI bundle"],
  ["tsup.config.ts", "src/playwright/index.ts", "build", "fixture bundle"],
  ["tsup.config.ts", "src/diff/worker.ts", "build", "worker bundle"],
  ["src/diff/runner.ts", "src/diff/worker.ts", "runtime-worker", "starts built diff-worker.js"],
  ["report-app/index.html", "report-app/src/main.tsx", "html-entry", "module script"],
  ["report-app/vite.config.ts", "report-app/index.html", "build", "HTML report build input"],
  ["src/reporters/html.ts", "report-app/index.html", "built-resource", "loads built HTML/JS/CSS"],
  ["vitest.config.ts", "test/global-setup.ts", "test-config", "globalSetup"],
  [
    "test/global-setup.ts",
    "report-app/vite.config.ts",
    "test-config",
    "builds report using configFile",
  ],
  ["test/pw/playwright.config.ts", "test/pw/global-setup.ts", "test-config", "globalSetup"],
  ["test/pw/playwright.config.ts", "test/pw/fixture.spec.ts", "test-config", "testMatch"],
  [
    "test/playwright-fixture.test.ts",
    "test/pw/playwright.config.ts",
    "subprocess",
    "launches Playwright runner",
  ],
  ["test/fixer.test.ts", "test/helpers/static-site-server.mjs", "subprocess", "dev-server helper"],
  [
    "test/report-fix.test.ts",
    "test/helpers/static-site-server.mjs",
    "subprocess",
    "dev-server helper",
  ],
  ["tsup.config.ts", "package.json", "build", "reads package version"],
  ["vitest.config.ts", "package.json", "test-config", "reads package version"],
];
for (const [from, to, kind, label] of supplements) {
  const edge = { from, to, kind, label };
  edges.push(edge);
  byId.get(from).dependencies.push(edge);
  byId.get(to).importedBy.push({ from, kind });
}
for (const record of records) {
  record.dependencies.sort(
    (a, b) =>
      (a.to ?? a.specifier).localeCompare(b.to ?? b.specifier) || a.kind.localeCompare(b.kind),
  );
  record.importedBy.sort((a, b) => a.from.localeCompare(b.from));
}
const localEdges = edges.filter((edge) => edge.to);
const staticEdges = localEdges.filter((edge) => edge.line);
/**
 * Choose an inventory section from a file's directory. This groups the architecture guide
 * by package responsibility.
 */
const groupOf = (id) =>
  id.startsWith("src/")
    ? id.split("/").length === 2
      ? "src (public entry and declarations)"
      : id.split("/").slice(0, 2).join("/")
    : id.startsWith("report-app/src/")
      ? "report-app/src"
      : id.startsWith("test/helpers/")
        ? "test/helpers"
        : id.startsWith("test/pw/")
          ? "test/pw"
          : id.startsWith("test/")
            ? "test suites"
            : "Build and documentation";
const groups = new Map();
for (const record of records) {
  const group = groupOf(record.id);
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(record);
}
/**
 * Build a repository-relative Markdown link to a package file and optional source line.
 * Generated guides use these links to connect descriptions back to the code.
 */
const fileLink = (id, line) => `[${id}](../packages/visualguard/${id}${line ? "#L" + line : ""})`;
/**
 * Convert a file path into a safe, unique guide anchor. Replacing punctuation lets
 * inventory-table links jump to the file's detail block.
 */
const anchor = (id) => "file-" + id.replace(/[^a-zA-Z0-9-]/g, "-");
const marker = "<!-- generated-file-index -->";
const prefix = readFileSync(guidePath, "utf8").split(marker)[0].trimEnd();
let doc = prefix + "\n\n" + marker + "\n\n## Complete file inventory\n\n";
doc += `The package contains **${records.length} non-ignored files** in this snapshot. The scanner found **${staticEdges.length} local static dependency edges**, plus **${supplements.length} explicitly recorded lifecycle links**. A dependency points from the importing/using file to the file it needs. Type-only edges are compile-time relationships.\n\n`;
doc +=
  "Paths below are relative to `packages/visualguard/`. Every inventory row links to source and to its exact connection details. Generated `dist/` chunks, `node_modules/`, caches and browser artifacts are excluded. Root workflows, examples, fixtures and evals are outside the package; relevant external imports are listed in the connection details.\n\n";
for (const [group, files] of groups) {
  doc += `### ${group}\n\n| File | What the code does | Connections |\n| --- | --- | --- |\n`;
  for (const record of files)
    doc += `| ${fileLink(record.id)}${record.entry ? " **ENTRY**" : ""} | ${record.role} | [Details](#${anchor(record.id)}) |\n`;
  doc += "\n";
}
doc +=
  "## Exact file connections\n\nThese lists come from AST-parsed literal imports, re-exports, dynamic imports and `require` calls, plus the explicit entry/build/resource/subprocess links above. They do not infer every callback invocation, computed import, glob-selected test, command string, network request or filesystem artifact. A file without incoming imports can still be launched by a tool or referenced through generated output. External module strings are references, not assertions about transitive dependency trees.\n\n";
for (const record of records) {
  doc += `<a id="${anchor(record.id)}"></a>\n\n<details>\n<summary>${record.id}${record.entry ? " — entry point" : ""}</summary>\n\n${record.role}\n\n`;
  if (record.entry) doc += `**Entry:** ${record.entry}.\n\n`;
  if (record.exports.length)
    doc +=
      "**Exported symbols:** " +
      record.exports.map((name) => "`" + name + "`").join(", ") +
      ".\n\n";
  const local = record.dependencies.filter((edge) => edge.to);
  doc +=
    "**Depends on:** " +
    (local.length
      ? local.map((edge) => fileLink(edge.to) + " (" + edge.kind + ")").join("; ")
      : "No detected local dependency") +
    ".\n\n";
  const external = record.dependencies.filter((edge) => !edge.to);
  if (external.length)
    doc +=
      "**Outside the package / platform:** " +
      external.map((edge) => "`" + edge.specifier + "` (" + edge.kind + ")").join("; ") +
      ".\n\n";
  doc +=
    "**Used by:** " +
    (record.importedBy.length
      ? record.importedBy
          .map((edge) => fileLink(edge.from, edge.line) + " (" + edge.kind + ")")
          .join("; ")
      : "No detected local incoming dependency; see build/test/documentation role") +
    ".\n\n</details>\n\n";
}
writeFileSync(guidePath, await format(doc, { ...formatOptions, parser: "markdown" }));
console.log(
  `Mapped ${records.length} files, ${staticEdges.length} local static edges and ${supplements.length} lifecycle links.`,
);
