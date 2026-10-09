import { relative } from "node:path";
import pc from "picocolors";
import type { Reporter } from "../core/run.js";
import type { JobResult, RunManifest, Status } from "../core/types.js";
import { formatDuration, pluralize } from "../core/util.js";
import { VERSION } from "../core/version.js";

type Colors = ReturnType<typeof pc.createColors>;

export interface TerminalReporterOptions {
  stream?: NodeJS.WritableStream;
  /** Plain output: no colours, no box drawing (CI and non-TTY). */
  plain?: boolean;
  /** Commands to suggest at the end, e.g. "npx visualguard report". */
  nextSteps?: (manifest: RunManifest) => Array<[label: string, command: string]>;
}

export const STATUS_LABEL: Record<Status, string> = {
  pass: "PASS",
  accepted: "ACCEPTED",
  review: "REVIEW",
  regression: "REGRESSION",
  error: "ERROR",
};

export const STATUS_SYMBOL: Record<Status, string> = {
  pass: "✓",
  accepted: "✓",
  review: "⚠",
  regression: "✖",
  error: "!",
};

export function statusColor(colors: Colors, status: Status): (text: string) => string {
  switch (status) {
    case "pass":
    case "accepted":
      return colors.green;
    case "review":
      return colors.yellow;
    case "regression":
    case "error":
      return colors.red;
  }
}

/** One-line description of why a job has its status. */
export function jobDetail(job: JobResult): string {
  if (job.error) return `${job.error.stage} failed: ${job.error.message.split("\n")[0]}`;
  if (job.status === "accepted") return "matches an accepted change";
  if (job.analysis) return job.analysis.title;
  const finding =
    job.findings?.find((item) => item.severity === job.status) ??
    job.findings?.find((item) => item.severity !== "info") ??
    job.findings?.find((item) => item.source === "heuristic");
  if (finding) return finding.message;
  if (!job.diff || job.diff.diffPixels === 0) return "";
  const percent = job.diff.diffRatio * 100;
  const share = percent < 0.01 ? "<0.01%" : `${percent.toFixed(2)}%`;
  if (job.status === "pass") return `${job.diff.diffPixels}px within tolerance`;
  return `${share} changed · ${pluralize(job.regions.length, "region")}`;
}

export function terminalReporter(options: TerminalReporterOptions = {}): Reporter {
  const stream = options.stream ?? process.stdout;
  const plain = options.plain ?? false;
  const colors = pc.createColors(!plain && pc.isColorSupported);
  const write = (line = "") => stream.write(`${line}\n`);
  let routeWidth = 20;
  let viewportWidth = 8;

  return {
    name: "terminal",
    onEvent(event) {
      switch (event.type) {
        case "run:start": {
          routeWidth = Math.min(40, Math.max(12, ...event.jobs.map((job) => job.route.length)));
          viewportWidth = Math.max(8, ...event.jobs.map((job) => job.viewport.length));
          const viewports = Object.entries(event.viewports)
            .map(([name, vp]) => `${name} ${vp.width}×${vp.height}`)
            .join(" · ");

          if (plain) {
            write(`VisualGuard ${VERSION} · run #${event.number}`);
          } else {
            write(colors.cyan("╭──────────────────────────────────────────╮"));
            write(
              colors.cyan("│") +
                ` ${colors.bold("VisualGuard")} · visual regression`.padEnd(51) +
                colors.cyan("│"),
            );
            write(colors.cyan("╰──────────────────────────────────────────╯"));
          }
          write();
          if (event.baseURL.production) {
            write(`  ${colors.dim("production")}  ${event.baseURL.production}`);
            write(`  ${colors.dim("staging   ")}  ${event.baseURL.staging ?? "-"}`);
          } else {
            write(`  ${colors.dim("site      ")}  ${event.baseURL.staging ?? "-"}`);
          }
          write(`  ${colors.dim("viewports ")}  ${viewports}`);
          write(
            `  ${colors.dim("ai        ")}  ${event.ai ? `${event.ai.provider} (${event.ai.model})` : "off (heuristics only)"}`,
          );
          write();
          for (const warning of event.warnings) write(colors.yellow(`  ⚠ ${warning}`));
          const viewportCount = Object.keys(event.viewports).length;
          if (event.mergedShards) {
            write(
              `Merged ${pluralize(event.mergedShards, "shard")} · ${pluralize(event.jobs.length, "job")}`,
            );
          } else if (event.shard) {
            write(
              `Shard ${event.shard.index}/${event.shard.total}: ${pluralize(event.jobs.length, "job")} of ${pluralize(event.routeCount, "route")} × ${pluralize(viewportCount, "viewport")}${plain ? "..." : "…"}`,
            );
          } else {
            write(
              `Scanning ${pluralize(event.routeCount, "route")} × ${pluralize(viewportCount, "viewport")}${plain ? "..." : "…"}`,
            );
          }
          write();
          break;
        }
        case "warning":
          write(colors.yellow(`  ⚠ ${event.message}`));
          break;
        case "job:end": {
          const job = event.job;
          const color = statusColor(colors, job.status);
          const route =
            job.route.length > routeWidth ? `${job.route.slice(0, routeWidth - 1)}…` : job.route;
          const detail = jobDetail(job);
          const label = detail ? STATUS_LABEL[job.status].padEnd(10) : STATUS_LABEL[job.status];
          write(
            `  ${color(STATUS_SYMBOL[job.status])}  ${route.padEnd(routeWidth)}  ${colors.dim(job.viewport.padEnd(viewportWidth))}  ${color(label)}${detail ? `  ${colors.dim(detail)}` : ""}`,
          );
          break;
        }
        case "run:end": {
          const { manifest, runDir } = event;
          const { summary } = manifest;
          const parts = [
            colors.green(`${summary.pass} passed`),
            summary.accepted > 0 ? colors.green(`${summary.accepted} accepted`) : undefined,
            (summary.review > 0 ? colors.yellow : colors.dim)(`${summary.review} review`),
            (summary.regression > 0 ? colors.red : colors.dim)(
              `${pluralize(summary.regression, "regression")}`,
            ),
            (summary.error > 0 ? colors.red : colors.dim)(`${pluralize(summary.error, "error")}`),
          ].filter(Boolean);
          const rule = plain ? "-".repeat(60) : colors.dim("━".repeat(60));
          write();
          write(rule);
          const explained = manifest.jobs
            .filter((job) => job.status === "regression" && job.analysis)
            .slice(0, 5);
          if (explained.length > 0) {
            write();
            write(`  ${colors.bold("AI ANALYSIS")}`);
            for (const job of explained) writeAnalysis(write, colors, job);
            write();
            write(rule);
          }
          write();
          write(
            `  ${parts.join(colors.dim(" · "))}   ${colors.dim(`(${formatDuration(manifest.durationMs)})`)}`,
          );
          if (manifest.usage && manifest.usage.aiCalls > 0) {
            const k = (tokens: number) =>
              tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
            write(
              colors.dim(
                `  AI: ${manifest.config.ai.model} · ${pluralize(manifest.usage.aiCalls, "call")} · ${k(manifest.usage.inputTokens)} tokens in / ${k(manifest.usage.outputTokens)} out${manifest.usage.thinkingTokens ? ` (${k(manifest.usage.thinkingTokens)} thinking)` : ""}`,
              ),
            );
          }
          write();
          const steps: Array<[string, string]> = [
            ["Results", relative(process.cwd(), runDir) || runDir],
            ...(options.nextSteps?.(manifest) ?? []),
          ];
          for (const [label, command] of steps)
            write(`  ${colors.dim(label.padEnd(8))} ${command}`);
          write();
          break;
        }
        default:
          break;
      }
    },
  };
}

/** The "AI ANALYSIS" block for one job (PLAN.md §3.6). */
export function writeAnalysis(
  write: (line?: string) => void,
  colors: Colors,
  job: JobResult,
): void {
  const analysis = job.analysis!;
  const label = analysis.classification[0]!.toUpperCase() + analysis.classification.slice(1);
  write();
  write(`  ${colors.bold(job.route)} ${colors.dim(`· ${job.viewport}`)}`);
  write(
    `  ${statusColor(colors, job.status)(label)} ${colors.dim(`· model confidence ${analysis.confidence.toFixed(2)}`)}`,
  );
  write();
  write(`  ${analysis.title}`);
  if (analysis.summary && analysis.summary !== analysis.title)
    write(`  ${colors.dim(analysis.summary)}`);
  if (analysis.likelyCause) write(`  ${colors.dim("Cause   ")} ${analysis.likelyCause}`);
  if (analysis.affected.length > 0) {
    write(
      `  ${colors.dim("Element ")} ${analysis.affected.map((item) => item.component ?? item.selector).join(", ")}`,
    );
  }
  if (analysis.suggestedFix) {
    write(`  ${colors.dim("Fix     ")} ${analysis.suggestedFix.description}`);
    for (const line of analysis.suggestedFix.snippet?.split("\n") ?? []) {
      write(
        `  ${line.startsWith("+") ? colors.green(line) : line.startsWith("-") ? colors.red(line) : line}`,
      );
    }
  }
}
