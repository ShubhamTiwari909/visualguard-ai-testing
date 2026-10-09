/**
 * @file Loads the prebuilt React report, embeds JS/CSS plus escaped manifest data and writes
 * per-run HTML.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EnvironmentError } from "../core/errors.js";
import type { Reporter } from "../core/run.js";
import type { RunManifest } from "../core/types.js";

interface ReportApp {
  html: string;
  js: string;
  css: string;
}

let cachedApp: ReportApp | undefined;

/**
 * Finds the prebuilt report app: next to the bundle in dist/, or dist/ when running from
 * source.
 *
 * Locate the prebuilt report UI beside the bundle or in the package dist directory. Throw an
 * actionable error when report assets have not been built or packaged.
 */
export function reportAppDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "report-app"), join(here, "../../dist/report-app")];
  const found = candidates.find((dir) => existsSync(join(dir, "index.html")));
  if (!found) {
    throw new EnvironmentError("The report app is missing from this install of VisualGuard.", {
      hint: "Reinstall visualguard, or run `pnpm build` in the VisualGuard repository.",
    });
  }
  return found;
}

/**
 * Read and cache the report HTML, JavaScript and CSS assets. Repeated report renders reuse the
 * cached strings instead of reopening all asset files.
 */
function loadApp(): ReportApp {
  if (cachedApp) return cachedApp;
  const dir = reportAppDir();
  cachedApp = {
    html: readFileSync(join(dir, "index.html"), "utf8"),
    js: readFileSync(join(dir, "assets", "app.js"), "utf8"),
    css: readFileSync(join(dir, "assets", "style.css"), "utf8"),
  };
  return cachedApp;
}

/**
 * JSON that is safe inside a <script> element.
 *
 * Serialize report data safely for an HTML script element. Escaping < prevents data text from
 * closing the script tag; line separators are escaped for compatible JavaScript parsing.
 */
function scriptJSON(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export interface RenderOptions {
  /**
   * Present when served by `visualguard report`: enables actions through the local API.
   */
  server?: { token: string; fixEnabled?: boolean };
}

/**
 * Renders a self-contained report page. Scripts and styles are inlined because module scripts
 * cannot load from file:// URLs; screenshots are referenced relative to the run directory.
 *
 * Embed the manifest and prebuilt UI assets into a self-contained HTML page. Keep screenshot
 * references relative to the run so both local serving and file viewing can find them.
 */
export function renderReportHTML(manifest: RunManifest, options: RenderOptions = {}): string {
  const app = loadApp();
  const data = `<script>window.__VISUALGUARD__=${scriptJSON({ manifest, generatedAt: new Date().toISOString() })};${
    options.server ? `window.__VISUALGUARD_SERVER__=${scriptJSON(options.server)};` : ""
  }</script>`;
  const js = app.js.replace(/<\/script/gi, "<\\/script");
  const css = app.css.replace(/<\/style/gi, "<\\/style");

  // Function replacers: the inlined code contains "$" sequences that string replacement would expand.
  return app.html
    .replace("<!--visualguard:data-->", () => data)
    .replace(
      /<script type="module"[^>]*src="\.\/assets\/app\.js"[^>]*><\/script>/,
      () => `<script type="module">${js}</script>`,
    )
    .replace(
      /<link rel="stylesheet"[^>]*href="\.\/assets\/style\.css"[^>]*>/,
      () => `<style>${css}</style>`,
    );
}

/**
 * Return the HTML entry-file path inside a saved run directory. Writers and callers share this
 * filename through the helper.
 */
export function reportPath(runDir: string): string {
  return join(runDir, "index.html");
}

/**
 * Writes `<runDir>/index.html`.
 *
 * Render and write the run's index.html, then return its path. The run directory must already
 * exist.
 */
export function writeReport(runDir: string, manifest: RunManifest): string {
  const path = reportPath(runDir);
  writeFileSync(path, renderReportHTML(manifest));
  return path;
}

/**
 * Create a run-end reporter for the self-contained HTML report. Its callback uses the context's
 * runDir supplied by the runner.
 */
export function htmlReporter(): Reporter {
  return {
    name: "html",
    /**
     * Write the finished manifest's HTML report into its artifact directory. This runs after
     * the final result data is available.
     */
    onRunEnd(manifest, { runDir }) {
      writeReport(runDir, manifest);
    },
  };
}
