import { basename, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import open from "open";
import pc from "picocolors";
import type { ResolvedConfig } from "../../config/resolve.js";
import { findRun, readManifest } from "../../core/runs.js";
import { acceptChanges } from "./accept.js";
import { writeReport } from "../../reporters/html.js";
import { startReportServer, type ApiHandler } from "../../server/report-server.js";
import { isCI, loadResolvedConfig, parsePositiveInt } from "../shared.js";

export interface ReportFlags {
  config?: string;
  run?: string;
  port?: number;
  open: boolean;
  serve: boolean;
}

/** Actions the served report can trigger (POST /api/<name>). */
export const reportActions: Record<
  string,
  (context: { runDir: string; config: ResolvedConfig }) => ApiHandler
> = {
  accept:
    ({ config, runDir }) =>
    (body) => {
      const { jobId, note } = body as { jobId?: unknown; note?: unknown };
      if (typeof jobId !== "string") throw new Error("jobId is required");
      const result = acceptChanges(config, {
        runId: basename(runDir),
        jobIds: [jobId],
        note: typeof note === "string" ? note : undefined,
      });
      return { accepted: result.added.map((item) => item.job) };
    },
};

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("open the HTML report for the latest run (or --run <id>)")
    .option("-c, --config <path>", "config file path")
    .option("--run <id>", "run id, id prefix or run number (default: latest)")
    .option("--port <n>", "port to serve on (default: random)", parsePositiveInt)
    .option("--no-open", "don't open a browser")
    .option("--no-serve", "only write index.html and print its path")
    .action(async (flags: ReportFlags) => {
      await runReportCommand(flags);
    });
}

export async function runReportCommand(flags: ReportFlags): Promise<void> {
  const config = await loadResolvedConfig({ config: flags.config });
  const { dir } = findRun(config.outputDir, flags.run);
  const manifest = readManifest(dir);
  const path = writeReport(dir, manifest);
  const fileURL = pathToFileURL(path).href;

  if (!flags.serve) {
    process.stdout.write(`${fileURL}\n`);
    return;
  }

  const api = Object.fromEntries(
    Object.entries(reportActions).map(([name, create]) => [name, create({ runDir: dir, config })]),
  );
  const server = await startReportServer({ runDir: dir, port: flags.port, api });
  process.stdout.write(
    `\n  ${pc.bold("VisualGuard report")} · run #${manifest.number}\n\n` +
      `  ${pc.dim("Local  ")} ${pc.cyan(server.url)}\n` +
      `  ${pc.dim("File   ")} ${relative(process.cwd(), path) || path}\n\n` +
      `  ${pc.dim("Press Ctrl+C to stop.")}\n\n`,
  );
  if (flags.open && !isCI()) await open(server.url).catch(() => {});

  await new Promise<void>((resolve) => {
    const stop = () => {
      void server.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
