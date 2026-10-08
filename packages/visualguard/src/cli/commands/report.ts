import { basename, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import open from "open";
import pc from "picocolors";
import type { ResolvedConfig } from "../../config/resolve.js";
import { findRun, readManifest } from "../../core/runs.js";
import { createProvider } from "../../ai/factory.js";
import type { JobResult } from "../../core/types.js";
import type { Edit } from "../../fixer/edits.js";
import { validateEdits } from "../../fixer/edits.js";
import { applyAndVerify, prepareWorkspace, proposeEdits } from "../../fixer/fix.js";
import { changedSince } from "../../fixer/git.js";
import { DevServer } from "../../fixer/verify.js";
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

  /** Step 1 of "Generate fix": a proposal with its diff; nothing is changed yet. */
  "fix-propose":
    ({ config, runDir }) =>
    async (body) => {
      const job = fixableJob(config, runDir, body);
      const workspace = prepareWorkspace(config, job, {
        workdir: config.cwd,
        runDir,
        changed: config.fix.compareRef
          ? new Set(changedSince(config.cwd, config.fix.compareRef))
          : undefined,
      });
      if (workspace.candidates.length === 0)
        return { ok: false, message: "No source files matched this change (check fix.include)." };
      const proposed = await proposeEdits(config, workspace, {
        attempt: 1,
        useHeuristic: true,
        provider: createProvider(config.ai).provider,
        // Consent is given in the terminal (`visualguard fix`) or with fix.allowSourceUpload.
        consent: async () => false,
      });
      if (proposed.kind === "proposal") {
        const { edits, diff, summary, source } = proposed.proposal;
        return { ok: true, edits, diff, summary, source };
      }
      if (proposed.kind === "invalid")
        return {
          ok: false,
          message: `The proposed edits were invalid: ${proposed.problems.join(" ")}`,
        };
      return {
        ok: false,
        message:
          proposed.message === "Not sending source code to the AI provider."
            ? "Run `npx visualguard fix` once in a terminal to allow sending source code to the AI provider."
            : proposed.message,
      };
    },

  /** Step 2 of "Generate fix": apply the confirmed edits and verify them visually. */
  "fix-apply":
    ({ config, runDir }) =>
    async (body) => {
      const job = fixableJob(config, runDir, body);
      const edits = (body as { edits?: unknown }).edits;
      if (!Array.isArray(edits)) throw new Error("edits are required");
      const problems = validateEdits(config.cwd, edits as Edit[], config.fix.include);
      if (problems.length > 0) return { ok: false, message: problems.join(" ") };
      const server = config.fix.verify.server
        ? new DevServer(config.fix.verify.server, config.cwd)
        : undefined;
      try {
        const result = await applyAndVerify(config, job, config.cwd, edits as Edit[], { server });
        if (result.kind === "done")
          return { ok: true, result: result.result, message: result.message };
        return {
          ok: false,
          message: result.kind === "retry" ? `Reverted: ${result.feedback}` : result.message,
        };
      } finally {
        await server?.stop();
      }
    },
};

function fixableJob(config: ResolvedConfig, runDir: string, body: unknown): JobResult {
  if (!config.fix.enabled)
    throw new Error("Fixing is turned off (fix.enabled in visualguard.config.ts).");
  const { jobId } = body as { jobId?: unknown };
  if (typeof jobId !== "string") throw new Error("jobId is required");
  const job = readManifest(runDir).jobs.find((candidate) => candidate.id === jobId);
  if (!job || !job.captures.production || !job.captures.staging)
    throw new Error(`No fixable job "${jobId}" in this run`);
  return job;
}

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
  const server = await startReportServer({
    runDir: dir,
    port: flags.port,
    api,
    fixEnabled: config.fix.enabled,
  });
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
