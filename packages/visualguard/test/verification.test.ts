/**
 * @file Tests immutable references when production is offline and rollback of collateral
 * viewport damage.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRun } from "../src/core/run.js";
import { fixRegressions } from "../src/fixer/fix.js";
import { verifyAgainstProduction } from "../src/fixer/verify.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { MockProvider } from "./helpers/mock-provider.js";

it("verifies against the saved reference after production goes offline, preserving route capture policy", async () => {
  const production = await startFixtureServer("production");
  const local = await startFixtureServer("production");
  try {
    const config = testConfig({
      baseURL: { production: production.url, staging: local.url },
      routes: [{ path: "/identical", waitFor: "main", mask: ["footer"], hide: ["nav"] }],
      viewports: { mobile: { width: 390, height: 844 } },
    });
    const { manifest, runDir } = await createRun(config).start();
    await production.close();
    const result = await verifyAgainstProduction(config, manifest.jobs[0]!, local.url, runDir);
    expect(result.resolved).toBe(true);
    expect(result.job.capturePolicy).toMatchObject({
      waitFor: "main",
      mask: ["footer"],
      hide: ["nav"],
      viewport: { width: 390 },
    });
    expect(result.job.captures.production?.source).toBe("baseline");
  } finally {
    await local.close();
  }
}, 60_000);

it("reverts a desktop repair that changes the previously passing mobile variant", async () => {
  const config = testConfig({
    routes: ["/example"],
    viewports: { desktop: { width: 1000, height: 600 }, mobile: { width: 390, height: 600 } },
    fix: { enabled: true, include: ["staging/**"], maxAttempts: 1, allowSourceUpload: true },
  });
  /**
   * Return a small responsive HTML page whose desktop text can be changed independently of
   * mobile content. This lets verification tests check that repairs are validated across
   * viewports.
   */
  const html = (text: string) =>
    `<html><head><style>body { margin: 0; } .desktop { display: none; } .mobile { color: black; } @media(min-width:700px) { .desktop { display: block; } .mobile { display: none; } }</style></head><body><h1 class="desktop">${text}</h1><h1 class="mobile">Mobile title</h1></body></html>`;
  for (const variant of ["production", "staging"]) {
    mkdirSync(join(config.cwd, variant));
    writeFileSync(
      join(config.cwd, variant, "example.html"),
      html(variant === "production" ? "After title" : "Before title"),
    );
  }
  writeFileSync(join(config.cwd, ".gitignore"), ".visualguard/\n");
  execFileSync("git", ["init", "-q"], { cwd: config.cwd });
  execFileSync("git", ["add", "."], { cwd: config.cwd });
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"],
    { cwd: config.cwd },
  );
  const production = await startFixtureServer("production", config.cwd);
  const staging = await startFixtureServer("staging", config.cwd);
  try {
    config.baseURL = { production: production.url, staging: staging.url };
    config.fix.verify.server = { url: staging.url, readyTimeoutMs: 5000 };
    const { manifest } = await createRun(config).start();
    expect(manifest.jobs.find((job) => job.viewport === "mobile")?.status).toBe("pass");
    const provider = new MockProvider(() => ({
      summary: "Restore title",
      confidence: 1,
      edits: [
        {
          file: "staging/example.html",
          search: "Before title",
          replace: "After title",
          reason: "restore",
        },
        {
          file: "staging/example.html",
          search: ".mobile { color: black; }",
          replace: ".mobile { color: red; }",
          reason: "unwanted side effect",
        },
      ],
    }));
    const outcomes = await fixRegressions(config, {
      includeReview: true,
      viewports: ["desktop"],
      provider,
      yes: true,
      callbacks: {
        /**
         * Approve this test proposal so the assertion reaches application and verification.
         */
        confirm: async () => true,
        /**
         * Grant source-upload consent for this fixture, allowing its mock-provider repair path.
         */
        consent: async () => true,
        /**
         * Ignore progress messages in this test; assertions inspect structured outcomes
         * instead.
         */
        progress: () => {},
      },
    });
    expect(outcomes[0]?.result).toBe("failed");
    expect(outcomes[0]?.message).toMatch(/Batch verification failed.*mobile/);
    expect(readFileSync(join(config.cwd, "staging/example.html"), "utf8")).toBe(
      html("Before title"),
    );
  } finally {
    await production.close();
    await staging.close();
  }
}, 60_000);
