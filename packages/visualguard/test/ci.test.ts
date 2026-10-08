import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { acceptChanges } from "../src/cli/commands/accept.js";
import { reportActions } from "../src/cli/commands/report.js";
import { readAccepted } from "../src/core/accepted.js";
import { createRun } from "../src/core/run.js";
import { readManifest } from "../src/core/runs.js";
import { exitCodeFor } from "../src/core/status.js";
import type { RunManifest } from "../src/core/types.js";
import { githubSummaryReporter, renderJUnit, webhookReporter } from "../src/reporters/ci.js";
import {
  findPullForCommit,
  githubContext,
  upsertComment,
} from "../src/reporters/github-comment.js";
import {
  COMMENT_MARKER,
  codeBlock,
  escapeMarkdown,
  inlineCode,
  renderMarkdown,
} from "../src/reporters/markdown.js";
import { renderWorkflow } from "../src/setup/workflow-template.js";
import { startReportServer } from "../src/server/report-server.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

let production: FixtureServer;
let staging: FixtureServer;
let config: ReturnType<typeof testConfig>;
let manifest: RunManifest;

beforeAll(async () => {
  production = await startFixtureServer("production");
  staging = await startFixtureServer("staging");
  config = testConfig({
    baseURL: { production: production.url, staging: staging.url },
    routes: ["/identical", "/text-change", "/color-change", "/hidden"],
  });
  ({ manifest } = await createRun(config).start());
}, 120_000);

afterAll(async () => {
  await production?.close();
  await staging?.close();
});

const statuses = (run: RunManifest) =>
  Object.fromEntries(run.jobs.map((job) => [job.route, job.status]));

describe("accepting changes", () => {
  it("--all accepts reviews only; later runs with the same screenshots pass as accepted", async () => {
    expect(statuses(manifest)).toEqual({
      "/identical": "pass",
      "/text-change": "review",
      "/color-change": "review",
      "/hidden": "regression",
    });
    const result = acceptChanges(config, { all: true, note: "new CTA copy" });
    expect(result.added.map((entry) => entry.route).sort()).toEqual([
      "/color-change",
      "/text-change",
    ]);
    expect(statuses(result.manifest)["/text-change"]).toBe("accepted");
    expect(readAccepted(config.acceptedPath).accepted).toHaveLength(2);

    const next = await createRun(config).start();
    expect(statuses(next.manifest)).toMatchObject({
      "/text-change": "accepted",
      "/hidden": "regression",
    });
    expect(next.manifest.jobs.find((job) => job.route === "/text-change")!.acceptedBy?.note).toBe(
      "new CTA copy",
    );
    expect(exitCodeFor(next.manifest, "review")).toBe(1); // /hidden is still a regression

    // Regressions can be accepted when named explicitly.
    acceptChanges(config, { routes: ["/hidden"] });
    const third = await createRun(config).start();
    expect(exitCodeFor(third.manifest, "any")).toBe(0);
  }, 120_000);

  it("the served report's accept action records one job", async () => {
    writeFileSync(config.acceptedPath, JSON.stringify({ version: 1, accepted: [] }));
    const { runDir } = await createRun(config, { reporters: [] }).start();
    const run = readManifest(runDir);
    const job = run.jobs.find((candidate) => candidate.route === "/color-change")!;
    expect(job.status).toBe("review");
    const server = await startReportServer({
      runDir,
      api: { accept: reportActions.accept!({ runDir, config }) },
    });
    try {
      const response = await fetch(new URL("api/accept", server.url), {
        method: "POST",
        headers: { "x-visualguard-token": server.token },
        body: JSON.stringify({ jobId: job.id }),
      });
      expect(await response.json()).toEqual({ accepted: [job.id] });
      expect(readManifest(runDir).jobs.find((candidate) => candidate.id === job.id)!.status).toBe(
        "accepted",
      );
      expect(basename(runDir)).toBe(run.id);
    } finally {
      await server.close();
    }
  }, 120_000);
});

describe("markdown", () => {
  it("escapes user-controlled text", () => {
    expect(escapeMarkdown("a|b <script> @team [x](y) `c`")).toBe(
      "a\\|b &lt;script&gt; @​team \\[x\\]\\(y\\) \\`c\\`",
    );
    expect(inlineCode("a`b")).toBe("`` a`b ``");
    expect(codeBlock("```\nx")).toBe("````\n```\nx\n````");
  });

  it("renders the comment with a marker, counts, a table and regression details", () => {
    const body = renderMarkdown(manifest, {
      marker: true,
      reportURL: "https://example.com/report",
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("🔴 **1 regression**");
    expect(body).toContain("[View full report](https://example.com/report)");
    expect(body).toContain("| 🔴 | `/hidden` | desktop |");
    expect(body).toContain("<summary>🔴 <code>/hidden</code>");
  });
});

describe("junit", () => {
  it("fails testcases per --fail-on", () => {
    const regression = renderJUnit(manifest, "regression");
    expect(regression).toContain('tests="4" failures="1" errors="0"');
    expect(regression).toMatch(
      /name="\/hidden \(desktop\)"[^]*?<failure message="\[data-testid=&quot;cta&quot;\]/,
    );
    expect(regression).toMatch(/name="\/text-change \(desktop\)"[^]*?<system-out>Text changed/);
    expect(renderJUnit(manifest, "review")).toContain('failures="3"');
  });
});

describe("GitHub integration", () => {
  let api: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (api ? api.close(() => resolve()) : resolve())));

  async function fakeGitHub() {
    const comments: Array<{ id: number; body: string }> = [];
    const calls: string[] = [];
    api = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        calls.push(`${request.method} ${request.url}`);
        const reply = (status: number, body: unknown) =>
          response
            .writeHead(status, { "content-type": "application/json" })
            .end(JSON.stringify(body));
        if (request.headers.authorization !== "Bearer t0ken")
          return reply(401, { message: "Bad credentials" });
        if (
          request.url?.startsWith("/repos/acme/web/issues/7/comments") &&
          request.method === "GET"
        )
          return reply(200, comments);
        if (request.url === "/repos/acme/web/issues/7/comments" && request.method === "POST") {
          const comment = { id: comments.length + 1, body: JSON.parse(raw).body as string };
          comments.push(comment);
          return reply(201, {
            ...comment,
            html_url: `https://github.com/acme/web/pull/7#issuecomment-${comment.id}`,
          });
        }
        const patch = request.url?.match(/^\/repos\/acme\/web\/issues\/comments\/(\d+)$/);
        if (patch && request.method === "PATCH") {
          const comment = comments.find((item) => item.id === Number(patch[1]))!;
          comment.body = JSON.parse(raw).body as string;
          return reply(200, { ...comment, html_url: "https://github.com/acme/web/pull/7#updated" });
        }
        if (request.url === "/repos/acme/web/commits/abc123/pulls")
          return reply(200, [{ number: 7, state: "open" }]);
        reply(404, { message: "Not Found" });
      });
    });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${(api!.address() as AddressInfo).port}`, comments, calls };
  }

  it("reads the PR from the event file and upserts one sticky comment", async () => {
    const github = await fakeGitHub();
    const eventPath = join(mkdtempSync(join(tmpdir(), "vg-gh-")), "event.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7 } }));
    const context = githubContext({
      GITHUB_TOKEN: "t0ken",
      GITHUB_REPOSITORY: "acme/web",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: github.url,
    });
    expect(context).toMatchObject({ owner: "acme", repo: "web", pullNumber: 7 });

    const first = await upsertComment(context, 7, `${COMMENT_MARKER}\nfirst`);
    const second = await upsertComment(context, 7, `${COMMENT_MARKER}\nsecond`);
    expect([first.action, second.action]).toEqual(["created", "updated"]);
    expect(github.comments).toEqual([{ id: 1, body: `${COMMENT_MARKER}\nsecond` }]);
  });

  it("finds the PR for a commit (deployment_status events) and explains permission errors", async () => {
    const github = await fakeGitHub();
    const context = githubContext({
      GITHUB_TOKEN: "t0ken",
      GITHUB_REPOSITORY: "acme/web",
      GITHUB_API_URL: github.url,
      GITHUB_SHA: "abc123",
    });
    expect(context.pullNumber).toBeUndefined();
    expect(await findPullForCommit(context)).toBe(7);

    const denied = githubContext({
      GITHUB_TOKEN: "nope",
      GITHUB_REPOSITORY: "acme/web",
      GITHUB_API_URL: github.url,
    });
    await expect(upsertComment(denied, 7, "x")).rejects.toThrow(/HTTP 401/);
    expect(() => githubContext({ GITHUB_REPOSITORY: "acme/web" })).toThrow(/GITHUB_TOKEN/);
  });

  it("writes the job summary and posts the webhook", async () => {
    const summaryPath = join(mkdtempSync(join(tmpdir(), "vg-summary-")), "summary.md");
    await githubSummaryReporter(summaryPath, "https://example.com/r").onRunEnd!(manifest, {
      runDir: "",
      config,
    });
    expect(readFileSync(summaryPath, "utf8")).toContain("## 🤖 VisualGuard");

    let received: Record<string, unknown> | undefined;
    api = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        received = JSON.parse(raw) as Record<string, unknown>;
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(api!.address() as AddressInfo).port}/hook`;
    await webhookReporter(url).onRunEnd!(manifest, { runDir: "", config });
    expect(received).toMatchObject({ tool: "visualguard", summary: manifest.summary });
    expect((received!.jobs as unknown[]).length).toBe(3);
  });
});

describe("workflow template", () => {
  it("uses the project's package manager and comments after uploading the report", () => {
    const pnpm = renderWorkflow("pnpm", { ai: true });
    expect(pnpm).toContain("uses: pnpm/action-setup@v4");
    expect(pnpm).toContain("run: pnpm exec visualguard test --ci --junit visualguard-junit.xml");
    expect(pnpm).toContain("GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}");
    expect(pnpm.indexOf("Upload the report")).toBeLessThan(pnpm.indexOf("visualguard comment"));
    const npm = renderWorkflow("npm", { ai: false });
    expect(npm).toContain("run: npm ci");
    expect(npm).toContain("npx visualguard comment");
    expect(npm).not.toContain("GEMINI_API_KEY");
  });
});
