import type { Command } from "commander";
import { VERSION } from "../../core/version.js";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { loadEnvFiles } from "../../config/load.js";

const metadata = (options: { environment?: string; branch?: string; commit?: string; pr?: string; deployment?: string }) => ({ environment: options.environment ?? "staging", branch: options.branch, commit: options.commit, pullRequest: options.pr === undefined ? undefined : Number(options.pr), deployment: options.deployment });
export function registerDashboardCommand(program: Command) {
  const dashboard = program.command("dashboard").description("Run a dashboard, manage projects, import/publish evidence, or generate hosting files")
    .option("--port <number>", "HTTP port (default: PORT or 4400)").option("--host <host>", "Listener address; external access requires login")
    .option("--data-dir <directory>", "Local data directory").option("--file <sqlite-file>", "Open a local SQLite database file").option("--env-file <file>", "Load dashboard environment settings from a file")
    .hook("preAction", (command) => {
      const options = command.opts();
      if (options.envFile) process.loadEnvFile(resolve(options.envFile));
      if (options.dataDir) process.env.VISUALGUARD_PLATFORM_DATA_DIR = resolve(options.dataDir);
      if (options.file) {
        if (process.env.VISUALGUARD_DATABASE_URL || process.env.DATABASE_URL) throw new Error("Unset the database URL to open a local SQLite file");
        try { if (!statSync(resolve(options.file)).isFile()) throw new Error("Not a file"); } catch { throw new Error("SQLite file does not exist; restore a backup first or omit --file to create a workspace"); }
        process.env.VISUALGUARD_SQLITE_FILE = resolve(options.file);
      }
    })
    .action(async (options) => {
      if (options.file && (process.env.VISUALGUARD_DATABASE_URL || process.env.DATABASE_URL)) throw new Error("Unset the database URL to open a local SQLite file");
      const runtime = await import("../../dashboard.js");
      const server = await runtime.startDashboard({ port: options.port === undefined ? undefined : Number(options.port), host: options.host, dataDir: options.dataDir, env: options.file ? { VISUALGUARD_SQLITE_FILE: options.file } : undefined });
      console.log(`VisualGuard dashboard: ${server.url}`);
      const stop = () => { void server.close(); }; process.once("SIGINT", stop); process.once("SIGTERM", stop);
    });
  const addMetadata = (command: Command) => command.option("--environment <name>", "Environment label", "staging").option("--branch <name>", "Branch label").option("--commit <sha>", "Source revision").option("--pr <number>", "Pull request number").option("--deployment <id>", "Deployment label");
  const project = dashboard.command("project").description("Manage dashboard projects");
  project.command("create <id>").alias("add").description("Create a project if its ID is not already present")
    .option("--name <name>", "Project display name (defaults to its ID)")
    .option("--server <url>", "Dashboard origin (or VISUALGUARD_DASHBOARD_URL); otherwise use the configured local database")
    .action(async (id: string, options: { name?: string; server?: string }, command: Command) => {
      loadEnvFiles(process.cwd());
      if (command.parent?.parent?.opts().file && (process.env.VISUALGUARD_DATABASE_URL || process.env.DATABASE_URL)) throw new Error("Unset the database URL to open a local SQLite file");
      const { createDashboardProject } = await import("../../dashboard.js");
      const result = await createDashboardProject({ id, name: options.name, server: options.server });
      console.log(`${result.created ? "Created" : "Already exists"}: ${result.project.name} (${result.project.id})`);
    });
  addMetadata(dashboard.command("import <run-directory>").description("Import a saved run into the configured database").requiredOption("--project <id>", "Project slug").option("--name <name>", "Project display name"))
    .action(async (runDirectory, options) => { const runtime = await import("../../dashboard.js"); const result = await runtime.importDashboardRun({ project: options.project, name: options.name, runDir: runDirectory, metadata: metadata(options) }); console.log(`${result.duplicate ? "Already imported" : "Imported"}: /runs/${result.run.id} [${result.run.status}]`); });
  addMetadata(dashboard.command("publish <run-directory>").description("Publish using VISUALGUARD_UPLOAD_TOKEN").requiredOption("--project <id>", "Project slug").requiredOption("--server <url>", "Dashboard origin"))
    .action(async (runDirectory, options) => { const runtime = await import("../../dashboard.js"); const result = await runtime.publishDashboardRun({ project: options.project, server: options.server, runDir: runDirectory, token: process.env.VISUALGUARD_UPLOAD_TOKEN, metadata: metadata(options), onProgress: console.log }); console.log(`${result.duplicate ? "Already published" : "Published"}: ${result.url} [${result.status}]`); });
  dashboard.command("export <file>").description("Export portable evidence without account secrets").action(async (file: string) => { const { exportDashboard } = await import("../../dashboard.js"); const result = await exportDashboard(file); console.log(`Exported ${result.runs} runs and ${result.objects} objects to ${result.file}`); });
  dashboard.command("restore <file>").description("Merge a portable backup without overwriting evidence").action(async (file: string) => { const { restoreDashboard } = await import("../../dashboard.js"); const result = await restoreDashboard(file); console.log(`Restored ${result.runs} runs and ${result.objects} objects`); });
  dashboard.command("assets").description("Copy prebuilt UI for static/serverless hosting").requiredOption("--out <directory>", "Output directory").action(async (options) => { const { copyDashboardAssets } = await import("../../dashboard.js"); console.log(await copyDashboardAssets(options.out)); });
  dashboard.command("init").description("Generate a minimal Cloud Run or Vercel project").requiredOption("--target <host>", "vercel or cloud-run").option("--out <directory>", "New deployment project directory", "visualguard-dashboard").option("--package <tarball>", "Use a local release-candidate package")
    .action(async (options) => { if (!["vercel", "cloud-run"].includes(options.target)) throw new Error("Target must be vercel or cloud-run"); const { scaffoldDashboard } = await import("../../dashboard.js"); console.log(await scaffoldDashboard({ target: options.target, out: options.out, packageFile: options.package, version: VERSION })); });
}
