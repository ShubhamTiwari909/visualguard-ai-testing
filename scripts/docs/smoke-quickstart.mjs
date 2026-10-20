import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const article = await readFile(join(root, 'apps/docs/src/content/docs/start/quickstart.md'), 'utf8');
const code = (language) => article.match(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'))?.[1];
const cwd = await mkdtemp(join(tmpdir(), 'visualguard-docs-quickstart-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VISUALGUARD_|GEMINI_|GOOGLE_API_KEY|OLLAMA_|DATABASE_URL)/.test(key)));
env.CI = '1';
let server;
let dashboard;
async function command(executable, args, allowed = [0]) {
  return await new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Timed out: ${args.join(' ')}`)); }, 180_000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', exit => { clearTimeout(timer); allowed.includes(exit) ? resolveCommand({ exit, output }) : reject(new Error(`${args.join(' ')} exited ${exit}\n${output.slice(-6000)}`)); });
  });
}
async function startDemo(source) {
  await writeFile(join(cwd, 'demo-sites.mjs'), source);
  server = spawn(process.execPath, ['demo-sites.mjs'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ready, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Demo did not start')), 10_000);
    server.stdout.on('data', chunk => { output += chunk; if (output.includes(':4100') && output.includes(':4101')) { clearTimeout(timer); ready(); } });
    server.on('error', reject);
    server.on('exit', exit => { clearTimeout(timer); reject(new Error(`Demo exited ${exit}; check ports 4100/4101`)); });
  });
}
async function stopDemo() {
  if (!server || server.exitCode !== null) return;
  await new Promise(done => { server.once('exit', done); server.kill('SIGTERM'); });
}
async function startDashboard() {
  const article = await readFile(join(root, 'apps/docs/src/content/docs/dashboard/local.md'), 'utf8');
  const settings = article.match(/```dotenv\n([\s\S]*?)\n```/)[1];
  await writeFile(join(cwd, '.env.visualguard'), settings);
  dashboard = spawn(process.execPath, ['node_modules/visualguard/dist/cli.js', 'dashboard', '--env-file', '.env.visualguard', '--port', '0'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return await new Promise((ready, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Dashboard did not start: ${output}`)), 15_000);
    dashboard.stdout.on('data', chunk => {
      output += chunk;
      const url = output.match(/VisualGuard dashboard: (http:\/\/[^\s]+)/)?.[1];
      if (url) { clearTimeout(timer); ready(url); }
    });
    dashboard.stderr.on('data', chunk => { output += chunk; });
    dashboard.on('error', reject);
    dashboard.on('exit', exit => { clearTimeout(timer); reject(new Error(`Dashboard exited ${exit}: ${output}`)); });
  });
}
async function stopDashboard() {
  if (!dashboard || dashboard.exitCode !== null) return;
  await new Promise(done => { dashboard.once('exit', done); dashboard.kill('SIGTERM'); });
}
try {
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'visualguard-docs-smoke', private: true }));
  console.log('Installing the documented npm release in a fresh project…');
  await command('npm', ['install', '--save-dev', '--save-exact', 'visualguard@3.2.3', 'playwright@1.64.0', '--ignore-scripts', '--no-audit', '--no-fund']);
  await writeFile(join(cwd, 'visualguard.config.ts'), code('ts'));
  await startDemo(code('js'));
  const cli = ['--no-install', 'visualguard'];
  assert.match((await command('npm', ['ls', 'visualguard', '--depth=0'])).output, /visualguard@3\.2\.3/);
  assert.match((await command('npx', [...cli, '--version'])).output, /3\.2\.2/); // Known published version-label mismatch.
  await command('npx', [...cli, 'doctor', '--config', 'visualguard.config.ts']);
  assert.match((await command('npx', [...cli, 'test', '--config', 'visualguard.config.ts', '--list'])).output, /desktop/);
  await command('npx', [...cli, 'test', '--config', 'visualguard.config.ts', '--no-ai'], [0, 1]);
  const runs = join(cwd, '.visualguard/runs');
  const firstDirectory = (await readdir(runs))[0];
  const first = JSON.parse(await readFile(join(runs, firstDirectory, 'manifest.json'), 'utf8'));
  assert.equal(first.jobs.length, 1);
  assert.ok(['review', 'regression'].includes(first.jobs[0].status), `Expected changed page, got ${first.jobs[0].status}`);
  await command('npx', [...cli, 'report', '--config', 'visualguard.config.ts', '--no-serve']);
  assert.match(await readFile(join(runs, firstDirectory, 'index.html'), 'utf8'), /VisualGuard/i);
  await stopDemo();
  await startDemo(code('js').replace("[4101, '#b42318']", "[4101, '#146c43']"));
  await command('npx', [...cli, 'test', '--config', 'visualguard.config.ts', '--no-ai']);
  const directories = await readdir(runs);
  const secondDirectory = directories.find(name => name !== firstDirectory);
  assert.ok(secondDirectory, 'Second comparison must create a separate run');
  const second = JSON.parse(await readFile(join(runs, secondDirectory, 'manifest.json'), 'utf8'));
  assert.equal(second.jobs[0].status, 'pass');
  console.log(`Quickstart passed: npm 3.2.3, doctor, comparison list, ${first.jobs[0].status} → pass, and HTML report.`);
  if (process.argv.includes('--dashboard')) {
    let origin = await startDashboard();
    assert.equal((await (await fetch(new URL('/api/health', origin))).json()).status, 'ok');
    await command('npx', [...cli, 'dashboard', 'project', 'create', 'storefront', '--name', 'Storefront Web', '--server', origin]);
    await command('npx', [...cli, 'test', 'storefront', '--dashboard', origin, '--config', 'visualguard.config.ts', '--no-ai']);
    const projects = await (await fetch(new URL('/api/projects', origin))).json();
    assert.match(JSON.stringify(projects), /Storefront Web/);
    assert.match(JSON.stringify(projects), /"runCount":1/);
    await stopDashboard();
    origin = await startDashboard();
    const persisted = await (await fetch(new URL('/api/projects', origin))).json();
    assert.match(JSON.stringify(persisted), /Storefront Web/);
    assert.match(JSON.stringify(persisted), /"runCount":1/);
    console.log('Dashboard guide passed: explicit SQLite environment, project creation, bound capture, history and restart persistence.');
  }
} finally {
  await stopDashboard();
  await stopDemo();
  await rm(cwd, { recursive: true, force: true });
}
