/** Validate the source-only dashboard-host guide with Chromium, without a runner credential. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './shared.mjs';

const require = createRequire(join(root, 'apps/platform/package.json'));
const { createJiti } = require('jiti');
globalThis.__VISUALGUARD_VERSION__ = JSON.parse(await readFile(join(root, 'packages/visualguard/package.json'))).version;
const jiti = createJiti(import.meta.url);
const { startDashboard } = await jiti.import(join(root, 'apps/platform/server/runtime.ts'));
const directory = await mkdtemp(join(tmpdir(), 'vg-docs-host-'));
const fixtures = [];
const env = {
  VISUALGUARD_AUTH_MODE: 'local', VISUALGUARD_PUBLIC_URL: '',
  VISUALGUARD_DATABASE_URL: '', DATABASE_URL: '', VERCEL: '', K_SERVICE: '',
  VISUALGUARD_SQLITE_FILE: join(directory, 'metadata.sqlite'),
  VISUALGUARD_BUILT_IN_RUNNER: 'on', VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY: '1',
};
let dashboard;
let csrf;
let active;
async function start() {
  dashboard = await startDashboard({ host: '127.0.0.1', port: 0, dataDir: directory, env });
  csrf = (await (await fetch(`${dashboard.url}/api/session`)).json()).token;
}
async function request(path, method = 'GET', data) {
  const response = await fetch(dashboard.url + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-visualguard-platform-token': csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
try {
  for (const color of ['#146c43', '#b42318']) {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<html><body><h1>Host smoke</h1><button style="padding:24px;background:${color};color:white">Continue</button></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fixtures.push(server);
  }
  await start();
  await request('/api/projects', 'POST', { id: 'host-demo', name: 'Dashboard host demo' });
  const urls = fixtures.map(server => `http://127.0.0.1:${server.address().port}`);
  await request('/api/projects/host-demo/test-config', 'PUT', {
    expectedVersion: 0,
    config: {
      baseURL: { production: urls[0], staging: urls[1] },
      routes: ['/', '/pricing'],
      viewports: { desktop: { width: 400, height: 300 } },
      ai: { provider: 'none' },
    },
  });
  const available = await request('/api/projects/host-demo/test-execution');
  assert.equal(available.builtInRunner, true);
  assert.equal(available.runnerOnline, false);
  const id = randomUUID();
  await request('/api/projects/host-demo/test-execution', 'POST', { id, configVersion: 1 });
  const observed = [];
  const deadline = Date.now() + 120_000;
  do {
    const status = await request('/api/projects/host-demo/test-execution');
    active = status.execution;
    if (active?.progress) observed.push(active.progress);
    if (['completed', 'failed'].includes(active?.status)) break;
    await delay(200);
  } while (Date.now() < deadline);
  assert.equal(active?.status, 'completed', JSON.stringify(active));
  assert.equal(active.id, id);
  assert.ok(observed.some(progress => progress.totalJobs === 2 && ['capturing', 'comparing'].includes(progress.stage)), 'No live capture progress');
  assert.equal(active.progress.completedJobs, 2);
  const run = await request(`/api/runs/${active.runId}`);
  assert.equal(run.projectId, 'host-demo');
  assert.equal(run.metadata.deployment, id);
  assert.equal(run.manifest.jobs.length, 2);
  assert.equal(run.manifest.config.ai.provider, 'none');
  assert.ok(run.manifest.jobs.some(job => ['review', 'regression'].includes(job.status)), 'Changed pages must produce a visual difference');
  assert.ok(run.artifacts.some(artifact => artifact.mediaType === 'image/png'));
  await dashboard.close();
  dashboard = undefined;
  await start();
  const reopened = await request(`/api/runs/${active.runId}`);
  assert.equal(reopened.projectId, 'host-demo');
  const image = reopened.artifacts.find(artifact => artifact.mediaType === 'image/png');
  assert.ok(image, 'Persisted run must include screenshot evidence');
  const imagePath = image.path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${dashboard.url}/api/runs/${active.runId}/artifacts/${imagePath}`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], 'Screenshot must remain readable after restart');
  assert.equal((await request('/api/projects/host-demo/test-execution')).execution.status, 'completed');
  console.log('Dashboard-host guide passed: saved profile, no private runner/token, real Chromium capture, live progress, changed-page evidence, SQLite history and restart persistence.');
} finally {
  // Wait for the owned background capture before closing its database or fixture servers.
  if (dashboard && active && !['completed', 'failed'].includes(active.status)) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await request('/api/projects/host-demo/test-execution').catch(() => null);
      if (!status?.execution || ['completed', 'failed'].includes(status.execution.status)) break;
      await delay(500);
    }
  }
  await dashboard?.close();
  for (const server of fixtures) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
