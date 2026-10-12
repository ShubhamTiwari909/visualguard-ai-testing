/**
 * @file Selects Vitest suites, test timeouts, report global setup and compile-time version
 * replacement.
 *
 * This file is read by development/build tooling. Its exported object configures that tool; it
 * is not a visual-test run or an application page.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: {
    __VISUALGUARD_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 30_000,
  },
});
