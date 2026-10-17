import type { Command } from "commander";
import { VERSION } from "../../core/version.js";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { loadEnvFiles } from "../../config/load.js";

const metadata = (options: {
  runName?: string;
  environment?: string;
  branch?: string;
  commit?: string;
  pr?: string;
  deployment?: string;
}) => ({
  runName: options.runName,
  environment: options.environment ?? "staging",
  branch: options.branch,
  commit: options.commit,
  pullRequest: options.pr === undefined ? undefined : Number(options.pr),
  deployment: options.deployment,
});
export function registerDashboardCommand(program: Command) {
  const dashboard = program
    .command("dashboard")
    .description(
      "Run a dashboard, manage projects, import/publish evidence, or generate hosting files",
    )
    .option("--port <number>", "HTTP port (default: PORT or 4400)")
    .option("--host <host>", "Listener address; external access requires login")
    .option("--data-dir <directory>", "Local data directory")
    .option("--file <sqlite-file>", "Open a local SQLite database file")
    .option("--env-file <file>", "Load dashboard environment settings from a file")
    .hook("preAction", (command) => {
      const options = command.opts();
      if (options.envFile) process.loadEnvFile(resolve(options.envFile));
      if (options.dataDir) process.env.VISUALGUARD_PLATFORM_DATA_DIR = resolve(options.dataDir);
      if (options.file) {
        if (process.env.VISUALGUARD_DATABASE_URL || process.env.DATABASE_URL)
          throw new Error("Unset the database URL to open a local SQLite file");
        try {
          if (!statSync(resolve(options.file)).isFile()) throw new Error("Not a file");
        } catch {
          throw new Error(
            "SQLite file does not exist; restore a backup first or omit --file to create a workspace",
          );
        }
        process.env.VISUALGUARD_SQLITE_FILE = resolve(options.file);
      }
    })
    .action(async (options) => {
      if (options.file && (process.env.VISUALGUARD_DATABASE_URL || process.env.DATABASE_URL))
        throw new Error("Unset the database URL to open a local SQLite file");
      const runtime = await import("../../dashboard.js");
      const server = await runtime.startDashboard({
        port: options.port === undefined ? undefined : Number(options.port),
        host: options.host,
        dataDir: options.dataDir,
        env: options.file ? { VISUALGUARD_SQLITE_FILE: options.file } : undefined,
      });
      console.log(`VisualGuard dashboard: ${server.url}`);
      const stop = () => {
        void server.close();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  const policy = dashboard.command("policy").description("Assess visual regression policy and reconcile exact-revision GitHub checks");
  policy.command("assess")
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--revision <sha>", "Exact source commit")
    .option("--run <id>", "Assess a specific stored run")
    .option("--server <url>", "Dashboard origin; otherwise use local storage")
    .option("--enforce", "Exit with failure unless the policy is satisfied")
    .action(async (options) => {
      loadEnvFiles(process.cwd());
      const { runPolicyCommand } = await import("../../dashboard.js");
      const result = await runPolicyCommand({ action: "assess", project: options.project, revision: options.revision, runId: options.run, server: options.server });
      console.log(JSON.stringify(result, null, 2));
      if (options.enforce && result.assessment?.status !== "satisfied") process.exitCode = 2;
    });
  policy.command("reconcile")
    .requiredOption("--project <id>", "Project ID")
    .option("--pr <number>", "Verify and publish the live PR head")
    .option("--all", "Refresh every tracked PR for this project")
    .option("--server <url>", "Dashboard origin; otherwise use local storage")
    .action(async (options) => {
      loadEnvFiles(process.cwd());
      if (Boolean(options.all) === Boolean(options.pr)) throw new Error("Choose either --pr or --all");
      const { runPolicyCommand } = await import("../../dashboard.js");
      const result = await runPolicyCommand({ action: "reconcile", project: options.project, pullRequest: options.pr ? Number(options.pr) : undefined, all: options.all, server: options.server });
      console.log(JSON.stringify(result, null, 2));
      if (result.errors?.length) process.exitCode = 2;
    });
  const addMetadata = (command: Command) =>
    command
      .option("--environment <name>", "Environment label", "staging")
      .option("--run-name <name>", "Custom dashboard run name")
      .option("--branch <name>", "Branch label")
      .option("--commit <sha>", "Source revision")
      .option("--pr <number>", "Pull request number")
      .option("--deployment <id>", "Deployment label");
  dashboard
    .command("baseline")
    .description("Download immutable approved references")
    .command("pull <set>")
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--out <directory>", "New baseline directory (must not exist)")
    .option("--version <number>", "Pin an earlier immutable version; defaults to current")
    .option("--server <url>", "Dashboard origin; otherwise use the local database")
    .action(
      async (
        set: string,
        options: { project: string; out: string; version?: string; server?: string },
      ) => {
        loadEnvFiles(process.cwd());
        const { pullApprovedBaseline } = await import("../../dashboard.js");
        const result = await pullApprovedBaseline({
          ...options,
          set,
          version: options.version === undefined ? undefined : Number(options.version),
        });
        console.log(
          `Pinned ${result.projectId}/${result.set} v${result.version}: ${result.checks} checks in ${result.directory}`,
        );
      },
    );
  const project = dashboard.command("project").description("Manage dashboard projects");
  project
    .command("create <id>")
    .alias("add")
    .description("Create a project if its ID is not already present")
    .option("--name <name>", "Project display name (defaults to its ID)")
    .option(
      "--server <url>",
      "Dashboard origin (or VISUALGUARD_DASHBOARD_URL); otherwise use the configured local database",
    )
    .action(async (id: string, options: { name?: string; server?: string }, command: Command) => {
      loadEnvFiles(process.cwd());
      if (
        command.parent?.parent?.opts().file &&
        (process.env.VISUALGUARD_DATABASE_URL || process.env.DATABASE_URL)
      )
        throw new Error("Unset the database URL to open a local SQLite file");
      const { createDashboardProject } = await import("../../dashboard.js");
      const result = await createDashboardProject({
        id,
        name: options.name,
        server: options.server,
      });
      console.log(
        `${result.created ? "Created" : "Already exists"}: ${result.project.name} (${result.project.publicId ?? result.project.id})`,
      );
    });
  addMetadata(
    dashboard
      .command("import <run-directory>")
      .description("Import a saved run into the configured database")
      .requiredOption("--project <id>", "Project slug")
      .option("--name <name>", "Project display name"),
  ).action(async (runDirectory, options) => {
    const runtime = await import("../../dashboard.js");
    const result = await runtime.importDashboardRun({
      project: options.project,
      name: options.name,
      runDir: runDirectory,
      metadata: metadata(options),
    });
    console.log(
      `${result.duplicate ? "Already imported" : "Imported"}: /runs/${result.run.id} [${result.run.status}]`,
    );
  });
  addMetadata(
    dashboard
      .command("publish <run-directory>")
      .description("Publish using VISUALGUARD_UPLOAD_TOKEN")
      .requiredOption("--project <id>", "Project slug")
      .requiredOption("--server <url>", "Dashboard origin"),
  ).action(async (runDirectory, options) => {
    const runtime = await import("../../dashboard.js");
    const result = await runtime.publishDashboardRun({
      project: options.project,
      server: options.server,
      runDir: runDirectory,
      token: process.env.VISUALGUARD_UPLOAD_TOKEN,
      metadata: metadata(options),
      onProgress: console.log,
    });
    console.log(
      `${result.duplicate ? "Already published" : "Published"}: ${result.url} [${result.status}]`,
    );
  });
  dashboard
    .command("export <file>")
    .description("Export portable evidence without account secrets")
    .action(async (file: string) => {
      const { exportDashboard } = await import("../../dashboard.js");
      const result = await exportDashboard(file);
      console.log(`Exported ${result.runs} runs and ${result.objects} objects to ${result.file}`);
    });
  dashboard
    .command("restore <file>")
    .description("Merge a portable backup without overwriting evidence")
    .action(async (file: string) => {
      const { restoreDashboard } = await import("../../dashboard.js");
      const result = await restoreDashboard(file);
      console.log(`Restored ${result.runs} runs and ${result.objects} objects`);
    });
  dashboard
    .command("assets")
    .description("Copy prebuilt UI for static/serverless hosting")
    .requiredOption("--out <directory>", "Output directory")
    .action(async (options) => {
      const { copyDashboardAssets } = await import("../../dashboard.js");
      console.log(await copyDashboardAssets(options.out));
    });
  dashboard
    .command("init")
    .description("Generate a minimal Cloud Run or Vercel project")
    .requiredOption("--target <host>", "vercel or cloud-run")
    .option("--out <directory>", "New deployment project directory", "visualguard-dashboard")
    .option("--package <tarball>", "Use a local release-candidate package")
    .action(async (options) => {
      if (!["vercel", "cloud-run"].includes(options.target))
        throw new Error("Target must be vercel or cloud-run");
      const { scaffoldDashboard } = await import("../../dashboard.js");
      console.log(
        await scaffoldDashboard({
          target: options.target,
          out: options.out,
          packageFile: options.package,
          version: VERSION,
        }),
      );
    });
}
