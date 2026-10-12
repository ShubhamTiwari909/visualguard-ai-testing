/**
 * @file Browser-tests the served report's propose → confirm → apply/verify repair flow.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reportActions } from "../src/cli/commands/report.js";
import { parseConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
import { createRun } from "../src/core/run.js";
import { DevServer } from "../src/fixer/verify.js";
import { htmlReporter } from "../src/reporters/html.js";
import { startReportServer } from "../src/server/report-server.js";
import { FIXTURE_ROOT, startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

/**
 * Ask the OS for an available localhost port by listening on port 0, then close the probe. The
 * Promise resolves after close; the returned port is a suggestion and is not reserved
 * afterward.
 */
const freePort = () =>
  new Promise<number>((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

describe("Generate fix in the served report", () => {
  let production: FixtureServer;
  let local: DevServer;
  let dir: string;
  let port: number;
  const serverScript = resolve(import.meta.dirname, "helpers/static-site-server.mjs");

  beforeAll(async () => {
    production = await startFixtureServer("production");
    port = await freePort();
    dir = mkdtempSync(join(tmpdir(), "vg-report-fix-"));
    cpSync(join(FIXTURE_ROOT, "staging"), join(dir, "site"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), ".visualguard/\n");
    /**
     * Run Git with a fixture-only identity inside the disposable repair repository. These
     * commands prepare/assert test state rather than changing the real project history.
     */
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], {
        cwd: dir,
        stdio: "pipe",
      });
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "init");
  });

  afterAll(async () => {
    await local?.stop();
    await production?.close();
  });

  it("proposes a diff, then applies and verifies it when confirmed", async () => {
    const config = resolveConfig(
      parseConfig({
        baseURL: { production: production.url, staging: `http://127.0.0.1:${port}` },
        routes: ["/alignment"],
        stabilize: { networkQuietMs: 100, freezeTime: "2026-01-01T00:00:00Z" },
        fix: {
          enabled: true,
          include: ["site/**"],
          verify: {
            server: {
              command: `node "${serverScript}" site ${port}`,
              url: `http://127.0.0.1:${port}`,
              readyTimeoutMs: 15_000,
            },
          },
        },
      }),
      { cwd: dir, env: {} },
    );
    local = new DevServer(config.fix.verify.server!, dir);
    await local.ensure();
    const { runDir } = await createRun(config, { reporters: [htmlReporter()] }).start();

    const api = Object.fromEntries(
      Object.entries(reportActions).map(([name, create]) => [name, create({ runDir, config })]),
    );
    const server = await startReportServer({ runDir, api, fixEnabled: true });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(server.url);
      await page.getByRole("button", { name: "Generate fix" }).click();
      const dialog = page.getByRole("dialog");
      await expect
        .poll(() => dialog.locator("pre").textContent(), { timeout: 30_000 })
        .toContain("align-items: center");
      expect(await dialog.textContent()).toContain("deterministic");
      await dialog.getByRole("button", { name: "Apply and verify" }).click();
      await expect
        .poll(() => dialog.getByRole("status").textContent(), { timeout: 60_000 })
        .toContain("/alignment now matches production");
      expect(readFileSync(join(dir, "site/alignment.html"), "utf8")).toContain(
        ".checkout-summary .actions { align-items: center; }",
      );
    } finally {
      await browser.close();
      await server.close();
    }
  }, 180_000);
});
