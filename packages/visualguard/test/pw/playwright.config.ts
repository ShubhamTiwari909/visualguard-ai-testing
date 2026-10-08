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
