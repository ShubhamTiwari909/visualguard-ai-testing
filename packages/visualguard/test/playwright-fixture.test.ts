import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs test/pw with the Playwright test runner. The specs import "visualguard/playwright", which
 * resolves to the built package, so this builds first.
 */
describe("visualguard/playwright fixture", () => {
  it("passes, fails and explains inside Playwright tests", () => {
    const root = resolve(import.meta.dirname, "..");
    const build = spawnSync("pnpm", ["exec", "tsup"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TSUP_NO_CLEAN: "1" },
    });
    expect(build.status, build.stderr).toBe(0);
    const run = spawnSync(
      "pnpm",
      ["exec", "playwright", "test", "-c", "test/pw/playwright.config.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, VG_PW_OUTPUT: mkdtempSync(join(tmpdir(), "vg-pw-out-")), CI: "1" },
      },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(/4 passed/);
  }, 240_000);
});
