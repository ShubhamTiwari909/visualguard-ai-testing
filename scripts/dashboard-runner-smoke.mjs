/** Real browser capture initiated through dashboard APIs and executed by the packaged CLI. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { startDashboard } from "../packages/visualguard/dist/dashboard.js";
const exec = promisify(execFile),
  repo = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "vg-runner-smoke-"));
const fixtures = [],
  dashboardEnv = {
    VISUALGUARD_AUTH_MODE: "local",
    VISUALGUARD_PUBLIC_URL: "",
    VISUALGUARD_DATABASE_URL: "",
    DATABASE_URL: "",
    VERCEL: "",
    K_SERVICE: "",
  };
let dashboard;
try {
  for (const color of ["blue", "red"]) {
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<html><body><button style="background:${color};color:white;padding:20px">Visual test</button></body></html>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    fixtures.push(server);
  }
  const urls = fixtures.map((server) => `http://127.0.0.1:${server.address().port}`);
  dashboard = await startDashboard({
    port: 0,
    host: "127.0.0.1",
    dataDir: join(root, "dashboard"),
    env: dashboardEnv,
  });
  const csrf = (await (await fetch(`${dashboard.url}/api/session`)).json()).token;
  const request = async (path, method = "GET", data) => {
    const response = await fetch(dashboard.url + path, {
      method,
      headers: { "Content-Type": "application/json", "x-visualguard-platform-token": csrf },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const value = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  };
  for (const project of ["runner-demo", "other-app"])
    await request("/api/projects", "POST", { id: project, name: project });
  const config = {
    baseURL: { production: urls[0], staging: urls[1] },
    routes: ["/", "/pricing"],
    viewports: { desktop: { width: 400, height: 300 } },
    ai: { provider: "none" },
  };
  await request("/api/projects/runner-demo/test-config", "PUT", { expectedVersion: 0, config });
  await request("/api/projects/other-app/test-config", "PUT", {
    expectedVersion: 0,
    config: { ...config, baseURL: { production: urls[1], staging: urls[0] } },
  });
  const key = await request("/api/projects/runner-demo/test-runner-key", "POST", {
    name: "Smoke runner",
    days: 1,
  });
  const env = {
    ...process.env,
    VISUALGUARD_RUNNER_TOKEN: key.token,
    VISUALGUARD_PRODUCTION_URL: "https://ignored.invalid",
    VISUALGUARD_STAGING_URL: "https://ignored.invalid",
    VISUALGUARD_AI_PROVIDER: "gemini",
  };
  const args = [
    join(repo, "packages/visualguard/dist/cli.js"),
    "dashboard",
    "runner",
    "--project",
    "runner-demo",
    "--server",
    dashboard.url,
    "--once",
    "--work-dir",
    join(root, "evidence"),
  ];
  await exec(process.execPath, args, { cwd: repo, env, timeout: 30000 });
  const id = randomUUID();
  await request("/api/projects/runner-demo/test-execution", "POST", { id, configVersion: 1 });
  let finished = false;
  const observed = [];
  const worker = exec(process.execPath, args, {
    cwd: repo,
    env,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  })
    .then(
      (result) => ({ result }),
      (error) => ({ error }),
    )
    .finally(() => {
      finished = true;
    });
  while (!finished) {
    const current = await request("/api/projects/runner-demo/test-execution");
    if (current.execution.progress) observed.push(current.execution.progress);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const output = await worker;
  if (output.error) throw output.error;
  const result = output.result;
  assert.ok(
    observed.some(
      (progress) => progress.totalJobs === 2 && ["capturing", "comparing"].includes(progress.stage),
    ),
    "No live comparison progress received",
  );
  assert.ok(
    observed.some((progress) => progress.completedJobs === 1),
    "Intermediate comparison count was not observable",
  );
  assert.ok(result.stdout.includes(`${dashboard.url}/runs/`));
  assert.ok(!result.stdout.includes(`${dashboard.url}${dashboard.url}`));
  const status = await request("/api/projects/runner-demo/test-execution");
  assert.equal(status.execution.status, "completed", result.stdout + result.stderr);
  assert.equal(status.execution.id, id);
  assert.deepEqual(
    {
      stage: status.execution.progress.stage,
      completedJobs: status.execution.progress.completedJobs,
      totalJobs: status.execution.progress.totalJobs,
    },
    { stage: "finalizing", completedJobs: 2, totalJobs: 2 },
  );
  const run = await request(`/api/runs/${status.execution.runId}`);
  assert.equal(run.projectId, "runner-demo");
  assert.equal(run.metadata.deployment, id);
  assert.equal(run.manifest.jobs.length, 2);
  assert.equal(new URL(run.manifest.config.baseURL.production).origin, urls[0]);
  assert.equal(new URL(run.manifest.config.baseURL.staging).origin, urls[1]);
  assert.equal(run.manifest.config.ai.provider, "none");
  assert.ok(run.artifacts.some((artifact) => artifact.mediaType === "image/png"));
  assert.equal(
    (await request("/api/projects/other-app/test-config")).config.baseURL.production,
    urls[1],
  );
  assert.equal((await request("/api/projects/other-app/test-execution")).execution, null);
  await request(`/api/projects/runner-demo/tokens/${key.id}`, "DELETE", {});
  await assert.rejects(exec(process.execPath, args, { cwd: repo, env, timeout: 30000 }));
  console.log(
    "Dashboard runner smoke passed: isolated project configs, credential-scoped queue/claim, real Chromium capture, persisted live comparison progress, evidence upload/result link, saved config overrides runner URL/provider settings, and revocation.",
  );
} finally {
  await dashboard?.close();
  for (const server of fixtures) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(root, { recursive: true, force: true });
}
