import { parseArgs } from "node:util";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { openPlatform } from "./config.js";
import { importRun } from "./ingest.js";

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: "string" }, name: { type: "string" }, run: { type: "string" }, "runs-dir": { type: "string" },
    environment: { type: "string", default: "staging" }, branch: { type: "string" }, commit: { type: "string" },
    pr: { type: "string" }, deployment: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log("pnpm platform:import --project <slug> [--name <name>] (--run <absolute-run-dir> | --runs-dir <absolute-runs-dir>) [--environment staging] [--branch feature] [--commit sha] [--pr 42] [--deployment id]");
    return;
  }
  if (!values.project || Boolean(values.run) === Boolean(values["runs-dir"])) throw new Error("Provide --project and exactly one of --run or --runs-dir. Use --help for examples.");
  const pr = values.pr === undefined ? undefined : Number(values.pr);
  if (pr !== undefined && (!Number.isSafeInteger(pr) || pr < 1)) throw new Error("--pr must be a positive integer");
  const platform = await openPlatform();
  try {
    await platform.repository.createProject(values.project, values.name ?? values.project);
    const dirs = values.run ? [resolve(values.run)] : (await readdir(resolve(values["runs-dir"]!), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => resolve(values["runs-dir"]!, entry.name)).sort();
    if (!dirs.length) throw new Error("No run directories found");
    let imported = 0;
    let failed = 0;
    for (const runDir of dirs) {
      try {
        const result = await importRun(platform.repository, platform.store, {
          projectId: values.project, runDir,
          metadata: { environment: values.environment ?? "staging", branch: values.branch, commit: values.commit, pullRequest: pr, deployment: values.deployment },
        });
        console.log(`${result.duplicate ? "Already imported" : "Imported"} ${result.run.engineRunId} → /runs/${result.run.id} [${result.run.status}]`);
        imported++;
      } catch (error) {
        failed++;
        console.error(`Import failed for ${runDir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`${imported} imported or already present; ${failed} failed.`);
    if (failed) process.exitCode = 1;
  } finally { await platform.close(); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
