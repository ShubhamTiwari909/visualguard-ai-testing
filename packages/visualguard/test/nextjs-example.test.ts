import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
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
  const seed = (...args: string[]) =>
    spawnSync("node", ["scripts/seed-regressions.mjs", ...args], { cwd: root });

  beforeAll(async () => {
    productionPort = await freePort();
    stagingPort = await freePort();
    const build = spawnSync("pnpm", ["exec", "next", "build"], { cwd: root, encoding: "utf8" });
    expect(build.status, build.stdout + build.stderr).toBe(0);
    production = spawn("pnpm", ["exec", "next", "start", "-p", String(productionPort)], {
      cwd: root,
      detached: true,
    });
    seed();
  }, 300_000);

  afterAll(() => {
    seed("--undo");
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
        callbacks: { confirm: async () => true, consent: async () => false, progress: () => {} },
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
