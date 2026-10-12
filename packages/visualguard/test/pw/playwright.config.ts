/**
 * @file Selects fixture specs, global setup, one worker, viewport and report/output settings.
 *
 * Configures the nested Playwright suite; global setup starts its fixture servers.
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
