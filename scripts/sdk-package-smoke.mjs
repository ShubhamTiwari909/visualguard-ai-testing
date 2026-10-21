/** Exercise the documented SDK script through a fresh installed npm archive. Build first. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "vg-sdk-package-"));
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    `<!doctype html><style>body{margin:0;background:${request.url?.startsWith("/changed") ? "red" : "blue"}}</style>`,
  );
});
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pkg = JSON.parse(await readFile(join(repo, "packages/visualguard/package.json"), "utf8"));
  let npm;
  for (const candidate of [
    resolve(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  ]) {
    try {
      await stat(candidate);
      npm = candidate;
      break;
    } catch {
      /* Try the next Node installation layout. */
    }
  }
  assert.ok(npm, "Cannot locate npm alongside Node.js");
  const release = join(temporary, "release");
  const consumer = join(temporary, "consumer");
  await mkdir(release);
  await mkdir(consumer);
  const packed = await exec(process.execPath, [
    npm,
    "pack",
    join(repo, "packages/visualguard"),
    "--json",
    "--pack-destination",
    release,
  ]);
  const [archive] = JSON.parse(packed.stdout);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "sdk-consumer-smoke", private: true, type: "module" }),
  );
  await exec(
    process.execPath,
    [
      npm,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(release, archive.filename),
      `playwright@${pkg.devDependencies.playwright}`,
    ],
    { cwd: consumer },
  );
  await cp(join(repo, "examples/sdk/visual-check.mjs"), join(consumer, "visual-check.mjs"));
  await cp(
    join(repo, "examples/sdk/visualguard.config.mjs"),
    join(consumer, "visualguard.config.mjs"),
  );
  const summary = join(consumer, "summary.md");
  await writeFile(summary, "Earlier step\n");
  const env = {
    ...process.env,
    VISUALGUARD_PRODUCTION_URL: origin,
    VISUALGUARD_STAGING_URL: origin,
    VISUALGUARD_AI_PROVIDER: "none",
    GITHUB_STEP_SUMMARY: summary,
  };
  delete env.VISUALGUARD_OUTPUT_DIR;
  const matching = await exec(process.execPath, ["visual-check.mjs"], { cwd: consumer, env });
  assert.match(matching.stdout, /HTML report:/);
  let failure;
  try {
    await exec(process.execPath, ["visual-check.mjs"], {
      cwd: consumer,
      env: { ...env, VISUALGUARD_STAGING_URL: `${origin}/changed` },
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 1, "Changed pages must fail the documented CI script");
  const runRoot = join(consumer, ".visualguard/runs");
  const index = JSON.parse(await readFile(join(runRoot, "index.json"), "utf8"));
  assert.equal(index.runs.length, 2);
  for (const [position, run] of index.runs.entries()) {
    const directory = join(runRoot, run.id);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    assert.match(await readFile(join(directory, "index.html"), "utf8"), /<html/);
    assert.match(await readFile(join(directory, "junit.xml"), "utf8"), /<testsuites/);
    for (const capture of Object.values(manifest.jobs[0].captures))
      assert.ok((await readFile(join(directory, capture.image))).length);
    if (position === 1) {
      assert.equal(manifest.summary.review, 1);
      assert.ok((await readFile(join(directory, manifest.jobs[0].diff.image))).length);
      assert.match(await readFile(join(directory, "junit.xml"), "utf8"), /failures="1"/);
    }
  }
  assert.match(await readFile(summary, "utf8"), /Earlier step/);
  assert.match(
    await readFile(join(consumer, "node_modules/visualguard/dist/index.d.ts"), "utf8"),
    /runVisualGuard/,
  );
  console.log(
    "SDK package smoke passed: fresh consumer, public export/declarations, documented script/config, pass/fail exit status, HTML/JUnit/JSON, screenshots and GitHub summary.",
  );
} finally {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  await rm(temporary, { recursive: true, force: true });
}
