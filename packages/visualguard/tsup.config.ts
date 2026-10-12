/**
 * @file Bundles API, CLI, Playwright fixture and diff worker; emits public declarations and
 * injects the version.
 *
 * This file is read by development/build tooling. Its exported object configures that tool; it
 * is not a visual-test run or an application page.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  // Each key becomes a published JavaScript entry file. The worker is loaded by URL;
  // it must exist as its own file even though consumers do not import it directly.
  entry: {
    index: "src/index.ts",
    cli: "src/cli/main.ts",
    "diff-worker": "src/diff/worker.ts",
    playwright: "src/playwright/index.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  // Generate .d.ts files for supported library APIs so consumers receive typed contracts.
  dts: { entry: { index: "src/index.ts", playwright: "src/playwright/index.ts" } },
  sourcemap: true,
  // Tests rebuild while other tests read dist/report-app, so they skip the clean step.
  clean: !process.env.TSUP_NO_CLEAN,
  splitting: true,
  // Playwright is an optional peer dependency, loaded lazily at runtime.
  external: ["playwright", "@playwright/test"],
  // Replace this identifier during bundling; source code does not read package.json at runtime.
  define: {
    __VISUALGUARD_VERSION__: JSON.stringify(pkg.version),
  },
});
