/**
 * @file Checks the packed npm artifact in a disposable consumer project, including its public
 * entry points.
 *
 * This is a repository-support script run by Node.js, outside the published package API.
 * Top-level await waits for setup before proceeding; async helpers return Promises. Read the
 * helpers below before invoking a script that starts processes or writes artifacts.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

// Packs the visualguard package, installs the tarball into a throwaway project,
// and checks that `npx visualguard --version` works the way a user would run it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pkgDir = resolve(import.meta.dirname, "../packages/visualguard");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "visualguard-smoke-"));
const isWindows = process.platform === "win32";

/**
 * Run a packaging-check command and capture its trimmed stdout. execFileSync throws on failure
 * so the smoke script cannot continue as if installation or invocation succeeded.
 */
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", shell: isWindows }).trim();

try {
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", work], pkgDir);
  const [{ filename }] = JSON.parse(packOutput);

  const project = join(work, "project");
  run("node", ["-e", `require("fs").mkdirSync(${JSON.stringify(project)})`], work);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "smoke", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", join(work, filename)], project);

  const version = run("npx", ["--no-install", "visualguard", "--version"], project);
  if (version !== pkg.version) {
    throw new Error(`Expected version ${pkg.version}, got "${version}"`);
  }
  console.log(`pack smoke test passed: visualguard ${version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
