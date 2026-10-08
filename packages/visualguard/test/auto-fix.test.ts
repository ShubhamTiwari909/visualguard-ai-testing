import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
import { createRun } from "../src/core/run.js";
import { autoFix, repoFromRemote } from "../src/fixer/auto.js";
import { DevServer } from "../src/fixer/verify.js";
import { FIXTURE_ROOT, startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

const freePort = () =>
  new Promise<number>((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

describe("fix --auto", () => {
  let production: FixtureServer;
  let github: Server;
  let githubURL: string;
  const pulls: Array<Record<string, unknown>> = [];
  let dir: string;
  let origin: string;
  let port: number;
  const serverScript = resolve(import.meta.dirname, "helpers/static-site-server.mjs");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();

  beforeAll(async () => {
    production = await startFixtureServer("production");
    port = await freePort();
    github = createHttpServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        if (request.method === "POST" && request.url === "/repos/acme/web/pulls") {
          pulls.push(JSON.parse(raw) as Record<string, unknown>);
          response
            .writeHead(201, { "content-type": "application/json" })
            .end(JSON.stringify({ number: 12, html_url: "https://github.com/acme/web/pull/12" }));
          return;
        }
        response.writeHead(404).end("{}");
      });
    });
    await new Promise<void>((done) => github.listen(0, "127.0.0.1", done));
    githubURL = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;

    origin = mkdtempSync(join(tmpdir(), "vg-origin-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    dir = mkdtempSync(join(tmpdir(), "vg-auto-"));
    cpSync(join(FIXTURE_ROOT, "staging"), join(dir, "site"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), ".visualguard/\n");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "init");
    git(dir, "remote", "add", "origin", origin);
    git(dir, "push", "-q", "origin", "main");
  }, 60_000);

  afterAll(async () => {
    await production?.close();
    await new Promise<void>((done) => github?.close(() => done()));
  });

  it("reads owner/repo from GitHub remotes", () => {
    expect(repoFromRemote("git@github.com:acme/web.git")).toBe("acme/web");
    expect(repoFromRemote("https://github.com/acme/web")).toBe("acme/web");
    expect(repoFromRemote("/tmp/origin")).toBeUndefined();
  });

  it("fixes in a worktree, commits on a branch, pushes and opens a PR, leaving the checkout alone", async () => {
    const config = resolveConfig(
      parseConfig({
        baseURL: { production: production.url, staging: `http://127.0.0.1:${port}` },
        routes: ["/alignment", "/color-change", "/text-change"],
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
    // Capture staging from the current checkout, then stop that server: the fix gets its own.
    const staging = new DevServer(config.fix.verify.server!, dir);
    await staging.ensure();
    const { manifest } = await createRun(config).start();
    await staging.stop();

    const messages: string[] = [];
    const result = await autoFix(config, {
      includeReview: true,
      pr: true,
      preferAPI: true,
      env: { GITHUB_TOKEN: "t0ken", GITHUB_REPOSITORY: "acme/web", GITHUB_API_URL: githubURL },
      progress: (message) => messages.push(message),
    });

    expect(
      Object.fromEntries(result.outcomes.map((outcome) => [outcome.job.route, outcome.result])),
    ).toEqual({
      "/alignment": "fixed",
      "/color-change": "fixed",
      "/text-change": "skipped", // copy changes need the AI
    });
    expect(result.branch).toBe(
      `visualguard/fix-${manifest.number}-${result.branch!.split("-").pop()}`,
    );
    expect(result.pr).toEqual({ url: "https://github.com/acme/web/pull/12", number: 12 });
    expect(pulls[0]).toMatchObject({
      head: result.branch,
      base: "main",
      title: "Fix visual regressions: restore 2 pages",
    });
    expect(String(pulls[0]!.body)).toContain("| `/alignment` | desktop | fixed:");

    // The branch reached origin with the fixes; the checkout and main are untouched.
    const pushed = git(origin, "show", `${result.branch}:site/alignment.html`);
    expect(pushed).toContain(".checkout-summary .actions { align-items: center; }");
    expect(readFileSync(join(dir, "site/alignment.html"), "utf8")).toContain(
      "align-items: flex-start",
    );
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(existsSync(join(dir, ".visualguard/worktrees"))).toBe(true);
    expect(git(dir, "worktree", "list").split("\n")).toHaveLength(1);
  }, 240_000);
});
