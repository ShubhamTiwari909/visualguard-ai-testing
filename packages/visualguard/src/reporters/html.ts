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

/** Finds the prebuilt report app: next to the bundle in dist/, or dist/ when running from source. */
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

/** JSON that is safe inside a <script> element. */
function scriptJSON(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export interface RenderOptions {
  /** Present when served by `visualguard report`: enables actions through the local API. */
  server?: { token: string };
}

/**
 * Renders a self-contained report page. Scripts and styles are inlined because module scripts
 * cannot load from file:// URLs; screenshots are referenced relative to the run directory.
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

export function reportPath(runDir: string): string {
  return join(runDir, "index.html");
}

/** Writes `<runDir>/index.html`. */
export function writeReport(runDir: string, manifest: RunManifest): string {
  const path = reportPath(runDir);
  writeFileSync(path, renderReportHTML(manifest));
  return path;
}

export function htmlReporter(): Reporter {
  return {
    name: "html",
    onRunEnd(manifest, { runDir }) {
      writeReport(runDir, manifest);
    },
  };
}
