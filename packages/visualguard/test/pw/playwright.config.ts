/**
 * @file Selects fixture specs, global setup, one worker, viewport and report/output settings.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { defineConfig } from "@playwright/test";

// Runs the visualguard/playwright fixture against the fixture site (see fixture.spec.ts).
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./global-setup.ts",
  workers: 1,
  reporter: "line",
  outputDir: process.env.VG_PW_OUTPUT ?? "../../.pw-output",
  use: { viewport: { width: 1280, height: 800 } },
});
