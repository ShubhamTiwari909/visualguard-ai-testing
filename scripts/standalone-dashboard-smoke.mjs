/** Install the packed package in a fresh consumer; no repository imports or browser binaries. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile),
  repo = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "vg-package-smoke-"));
let server;
try {
  const release = join(temporary, "release");
  await mkdir(release);
  await exec(
    "pnpm",
    ["--dir", join(repo, "packages/visualguard"), "pack", "--pack-destination", release],
    { cwd: repo },
  );
  const pkg = JSON.parse(await readFile(join(repo, "packages/visualguard/package.json"), "utf8"));
  const tarball = join(release, `visualguard-${pkg.version}.tgz`),
    consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "visualguard-consumer-smoke", private: true, type: "module" }),
  );
  const npmCandidates = [
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  ];
  let npm;
  for (const path of npmCandidates) {
    try {
      await stat(path);
      npm = path;
      break;
    } catch {
      /* Try another Node installation layout. */
    }
  }
  if (!npm) throw new Error("Cannot locate npm alongside the running Node binary");
  await exec(
    process.execPath,
    [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: consumer, maxBuffer: 4 * 1024 * 1024 },
  );
  const installed = join(consumer, "node_modules/visualguard/dist");
  const dashboard = await import(pathToFileURL(join(installed, "dashboard.js")).href);
  const core = await import(pathToFileURL(join(installed, "index.js")).href);
  assert.equal(typeof core.createRun, "function");
  const env = {
    VISUALGUARD_PLATFORM_DATA_DIR: join(consumer, "data"),
    VISUALGUARD_AUTH_MODE: "local",
    VISUALGUARD_PUBLIC_URL: "",
    VISUALGUARD_DATABASE_URL: "",
    DATABASE_URL: "",
    VERCEL: "",
    K_SERVICE: "",
  };
  server = await dashboard.startDashboard({ port: 0, host: "127.0.0.1", env });
  assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
  const reviews = await fetch(`${server.url}/reviews`, { redirect: "manual" });
  assert.equal(reviews.status, 200);
  assert.match(await reviews.text(), /<div id="root">/);
  const operations = await fetch(`${server.url}/operations`, { redirect: "manual" });
  assert.equal(operations.status, 200);
  assert.match(await operations.text(), /<div id="root">/);
  const policies = await fetch(`${server.url}/policies`, { redirect: "manual" });
  assert.equal(policies.status, 200);
  assert.match(await policies.text(), /<div id="root">/);
  const invitation = await fetch(`${server.url}/invite`, { redirect: "manual" });
  assert.equal(invitation.status, 200);
  assert.equal(invitation.headers.get("referrer-policy"), "no-referrer");
  assert.equal(invitation.headers.get("cache-control"), "no-store");
  assert.match(await invitation.text(), /<div id="root">/);
  const html = await (await fetch(server.url)).text();
  assert.match(html, /<div id="root">/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset);
  assert.equal((await fetch(new URL(asset, server.url))).status, 200);
  const fixture = join(consumer, "fixture");
  await mkdir(fixture);
  await writeFile(
    join(fixture, "image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const capture = {
    image: "image.png",
    size: { width: 1, height: 1 },
    health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
    durationMs: 1,
    attempts: 1,
  };
  await writeFile(
    join(fixture, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "package-smoke",
      number: 1,
      startedAt: new Date().toISOString(),
      durationMs: 1,
      mode: "compare",
      tool: { version: pkg.version },
      config: {
        baseURL: {},
        viewports: { desktop: { width: 1, height: 1 } },
        ai: { provider: "none" },
        failOn: "regression",
      },
      summary: { pass: 1, accepted: 0, review: 0, regression: 0, error: 0 },
      jobs: [
        {
          id: "home",
          route: "/",
          name: "Home",
          viewport: "desktop",
          status: "pass",
          durationMs: 1,
          urls: { production: "https://example.test", staging: "https://staging.test" },
          captures: { production: capture, staging: capture },
          regions: [],
        },
      ],
    }),
  );
  const imported = await dashboard.importDashboardRun({
    project: "smoke",
    runDir: fixture,
    metadata: { environment: "validation" },
    env,
  });
  assert.equal((await fetch(`${server.url}/api/runs/${imported.run.id}`)).status, 200);
  const uploaded = await dashboard.publishDashboardRun({
    server: server.url,
    project: "smoke",
    runDir: fixture,
    metadata: { environment: "validation" },
  });
  assert.equal(uploaded.id, imported.run.id);
  const backup = join(consumer, "evidence.vgbackup.gz");
  await dashboard.exportDashboard(backup, env);
  const restoredEnv = { ...env, VISUALGUARD_PLATFORM_DATA_DIR: join(consumer, "restored") };
  assert.equal((await dashboard.restoreDashboard(backup, restoredEnv)).runs, 1);
  const help = await exec(process.execPath, [join(installed, "cli.js"), "dashboard", "--help"], {
    cwd: consumer,
  });
  assert.match(help.stdout, /--env-file/);
  const csrf = (await (await fetch(`${server.url}/api/session`)).json()).token;
  const runnerKeyResponse = await fetch(`${server.url}/api/projects/smoke/test-runner-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-visualguard-platform-token": csrf },
    body: JSON.stringify({ name: "Fresh package runner", days: 1 }),
  });
  assert.equal(runnerKeyResponse.status, 201);
  const runnerKey = await runnerKeyResponse.json();
  await exec(
    process.execPath,
    [
      join(installed, "cli.js"),
      "dashboard",
      "runner",
      "--project",
      "smoke",
      "--server",
      server.url,
      "--once",
      "--work-dir",
      join(consumer, "runner-evidence"),
    ],
    {
      cwd: consumer,
      env: { ...process.env, VISUALGUARD_RUNNER_TOKEN: runnerKey.token },
    },
  );
  for (const target of ["vercel", "cloud-run"]) {
    const out = join(consumer, target);
    await dashboard.scaffoldDashboard({ target, out, version: pkg.version, packageFile: tarball });
    assert.equal(
      JSON.parse(await readFile(join(out, "package.json"), "utf8")).dependencies.visualguard,
      "file:./visualguard.tgz",
    );
    if (target === "vercel") {
      const config = JSON.parse(await readFile(join(out, "vercel.json"), "utf8"));
      for (const route of ["/reviews", "/invite", "/operations", "/baselines", "/policies"]) {
        assert.ok(
          config.rewrites.some(
            (rewrite) => rewrite.source === route && rewrite.destination === "/index.html",
          ),
        );
      }
    }
  }
  await dashboard.copyDashboardAssets(join(consumer, "public"));
  await stat(join(consumer, "public/index.html"));
  console.log(
    "Standalone package smoke passed: fresh install, core API, UI/assets, local start, import, publish, backup/restore, CLI/private runner polling, and both deployment scaffolds.",
  );
} finally {
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
}
