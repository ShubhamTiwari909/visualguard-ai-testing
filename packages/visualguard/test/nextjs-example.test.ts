/**
 * @file Opt-in real Next.js build/dev test: seeds three regressions and verifies repairs;
 * skipped without VG_E2E_NEXT.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
import type { CaptureHookContext } from "../src/config/schema.js";
import { createRun } from "../src/core/run.js";
import { fixRegressions } from "../src/fixer/fix.js";
import { DevServer } from "../src/fixer/verify.js";

/**
 * The Phase 7 "done when": seeded Tailwind regressions in examples/nextjs are found and fixed,
 * and each fix is verified against the production build. Slow (next build), so opt-in:
 * VG_E2E_NEXT=1 pnpm test
 */
const enabled = process.env.VG_E2E_NEXT === "1";
const root = resolve(import.meta.dirname, "../../../examples/nextjs");

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

describe.skipIf(!enabled)("Next.js example", () => {
  let production: ChildProcess | undefined;
  let productionPort: number;
  let stagingPort: number;
  const originals = new Map<string, string>();
  const work = mkdtempSync(join(tmpdir(), "vg-next-"));
  /**
   * Run the example's regression-seeding script with the requested arguments. Return the
   * process result so assertions can check command success and output.
   */
  const seed = (...args: string[]) =>
    spawnSync("node", ["scripts/seed-regressions.mjs", ...args], { cwd: root });

  beforeAll(async () => {
    for (const file of ["CheckoutSummary", "Hero", "PricingCard"]) {
      const path = join(root, "components", `${file}.tsx`);
      originals.set(path, readFileSync(path, "utf8"));
    }
    // Build a clean reference even when the checked-in demo contains seeded regressions.
    expect(seed("--undo").status).toBe(0);
    productionPort = await freePort();
    stagingPort = await freePort();
    const build = spawnSync("pnpm", ["exec", "next", "build"], { cwd: root, encoding: "utf8" });
    expect(build.status, build.stdout + build.stderr).toBe(0);
    production = spawn("pnpm", ["exec", "next", "start", "-p", String(productionPort)], {
      cwd: root,
      detached: true,
    });
    expect(seed().status).toBe(0);
  }, 300_000);

  afterAll(() => {
    for (const [path, content] of originals) writeFileSync(path, content);
    if (production?.pid) process.kill(-production.pid, "SIGTERM");
  });

  it("finds the three seeded regressions and fixes each one, verified", async () => {
    const config = resolveConfig(
      parseConfig({
        baseURL: {
          production: `http://127.0.0.1:${productionPort}`,
          staging: `http://127.0.0.1:${stagingPort}`,
        },
        routes: ["/", "/pricing", "/checkout"],
        output: { dir: join(work, "out"), acceptedFile: join(work, "accepted.json") },
        hooks: {
          beforeNavigate: async ({ page, env }: CaptureHookContext) => {
            if (env === "staging") {
              // Mock only the dev-server HMR socket; app errors remain health failures.
              await page.routeWebSocket(/\/_next\/(?:webpack-)?hmr(?:\?|$)/, () => {});
            }
          },
        },
        viewports: { desktop: { width: 1280, height: 800 } },
        stabilize: { freezeTime: "2026-01-01T00:00:00Z", hide: ["nextjs-portal"] },
        fix: {
          enabled: true,
          include: ["app/**", "components/**"],
          verify: {
            server: {
              command: `pnpm exec next dev -p ${stagingPort}`,
              url: `http://127.0.0.1:${stagingPort}`,
              readyTimeoutMs: 120_000,
            },
            commands: ["pnpm exec tsc --noEmit"],
          },
        },
      }),
      { cwd: root, env: {} },
    );
    const dev = new DevServer(config.fix.verify.server!, root);
    try {
      await dev.ensure();
      const { manifest } = await createRun(config).start();
      const findings = Object.fromEntries(
        manifest.jobs.map((job) => [job.route, job.findings?.[0]?.message ?? job.status]),
      );
      expect(findings["/"]).toMatch(
        /Colour changed: background-color #155dfc → #7f22fe on \[data-testid="cta"\]/,
      );
      expect(findings["/checkout"]).toMatch(/Alignment changed: align-items center → flex-start/);
      expect(findings["/pricing"]).toMatch(/Spacing changed: padding 24px → 12px/);

      const outcomes = await fixRegressions(config, {
        includeReview: true,
        yes: true,
        allowDirty: true,
        callbacks: {
          /**
           * Approve this test proposal so the assertion reaches application and verification.
           */
          confirm: async () => true,
          /**
           * Decline source upload in this test so only previously authorized/deterministic repair
           * can proceed.
           */
          consent: async () => false,
          /**
           * Ignore progress messages in this test; assertions inspect structured outcomes
           * instead.
           */
          progress: () => {},
        },
      });
      expect(
        Object.fromEntries(outcomes.map((outcome) => [outcome.job.route, outcome.result])),
      ).toEqual({
        "/": "fixed",
        "/checkout": "fixed",
        "/pricing": "fixed",
      });
    } finally {
      await dev.stop();
    }
  }, 600_000);
});
