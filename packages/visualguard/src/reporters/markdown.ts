/**
 * @file Escapes/formats Markdown run summaries and detailed findings for comments/job
 * summaries.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { JobResult, RunManifest, Status } from "../core/types.js";
import { VERSION } from "../core/version.js";

export const COMMENT_MARKER = "<!-- visualguard:report -->";

const EMOJI: Record<Status, string> = {
  pass: "✅",
  accepted: "☑️",
  review: "🟡",
  regression: "🔴",
  error: "❗",
};

const ORDER: Status[] = ["error", "regression", "review", "accepted", "pass"];

/**
 * Escapes text from pages, configs and models before it goes into Markdown, so a route or a
 * page title can't inject links, mentions, HTML or table cells (PLAN.md §12.3).
 *
 * Escape captured/user/model text before placing it in Markdown tables and paragraphs.
 * Normalize line breaks and neutralize mention syntax so evidence stays display text.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}[\]()#+!|~])/g, "\\$1")
    .replace(/@/g, "@​");
}

/**
 * Inline code that survives backticks in the content.
 *
 * Choose a backtick fence longer than any backticks inside the value. Normalize newlines and
 * escape table pipes so the value stays inside its cell.
 */
export function inlineCode(text: string): string {
  const clean = text.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
  const longest = Math.max(0, ...(clean.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return longest > 0 ? `${fence} ${clean} ${fence}` : `${fence}${clean}${fence}`;
}

/**
 * A fenced code block whose fence is longer than any backtick run in the content.
 *
 * Choose a multiline code fence that the supplied snippet cannot prematurely close. Keep the
 * optional language hint for syntax highlighting.
 */
export function codeBlock(text: string, language = ""): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

/**
 * Choose the most useful one-line explanation for a job, prioritizing errors and available
 * analysis. This supplies summary table text rather than changing the job verdict.
 */
function finding(job: JobResult): string {
  if (job.error) return `${job.error.stage} failed: ${job.error.message.split("\n")[0]}`;
  if (job.status === "accepted") return "matches an accepted change";
  if (job.analysis) return job.analysis.title;
  return (
    job.findings?.find((item) => item.severity === job.status)?.message ??
    job.findings?.find((item) => item.severity !== "info")?.message ??
    ""
  );
}

export interface MarkdownOptions {
  /**
   * Link to the full report (artifact or published URL).
   */
  reportURL?: string;
  /**
   * Include the hidden marker used to find and update the PR comment.
   */
  marker?: boolean;
  maxRows?: number;
  maxDetails?: number;
}

/**
 * The PR comment / job summary body (PLAN.md Appendix D).
 *
 * Build the run summary used by PR comments and CI step summaries. Bound table rows/details and
 * escape embedded evidence while retaining actionable report links.
 */
export function renderMarkdown(manifest: RunManifest, options: MarkdownOptions = {}): string {
  const { summary } = manifest;
  const maxRows = options.maxRows ?? 30;
  const maxDetails = options.maxDetails ?? 5;
  const lines: string[] = [];
  if (options.marker) lines.push(COMMENT_MARKER);
  lines.push("## 🤖 VisualGuard", "");

  const counts = [
    summary.error > 0 ? `❗ **${summary.error} error${summary.error === 1 ? "" : "s"}**` : "",
    summary.regression > 0
      ? `🔴 **${summary.regression} regression${summary.regression === 1 ? "" : "s"}**`
      : "",
    summary.review > 0 ? `🟡 ${summary.review} to review` : "",
    `✅ ${summary.pass} passed`,
    summary.accepted > 0 ? `☑️ ${summary.accepted} accepted` : "",
  ].filter(Boolean);
  const link = options.reportURL ? ` · [View full report](${encodeURI(options.reportURL)})` : "";
  lines.push(`${counts.join(" · ")}${link}`, "");

  const notable = [...manifest.jobs]
    .filter((job) => job.status !== "pass" && job.status !== "accepted")
    .sort(
      (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.route.localeCompare(b.route),
    );

  if (notable.length === 0) {
    lines.push("No visual differences need attention.", "");
  } else {
    lines.push("|     | Route | Viewport | Finding |", "| --- | ----- | -------- | ------- |");
    for (const job of notable.slice(0, maxRows)) {
      lines.push(
        `| ${EMOJI[job.status]} | ${inlineCode(job.route)} | ${escapeMarkdown(job.viewport)} | ${escapeMarkdown(finding(job))} |`,
      );
    }
    if (notable.length > maxRows)
      lines.push("", `…and ${notable.length - maxRows} more in the full report.`);
    lines.push("");

    for (const job of notable
      .filter((item) => item.status === "regression" || item.status === "error")
      .slice(0, maxDetails)) {
      lines.push(...details(job));
    }
  }

  const ai =
    manifest.config.ai.provider === "none"
      ? "heuristics only"
      : `${manifest.config.ai.provider} ${manifest.config.ai.model ?? ""}`.trim();
  lines.push(
    `<sub>VisualGuard ${VERSION} · ${escapeMarkdown(ai)} · run #${manifest.number} · accept intentional changes with <code>npx visualguard accept &lt;route&gt;</code></sub>`,
  );
  return lines.join("\n");
}

/**
 * Build expandable Markdown/HTML detail lines for one problem job. Include evidence and any
 * suggested snippet with appropriate escaping/fences.
 */
function details(job: JobResult): string[] {
  const lines: string[] = [];
  const confidence = job.analysis
    ? ` (model confidence ${job.analysis.confidence.toFixed(2)})`
    : "";
  lines.push(
    "<details>",
    `<summary>${EMOJI[job.status]} <code>${escapeHtml(job.route)}</code> · ${escapeHtml(job.viewport)} · ${job.status}${confidence}</summary>`,
    "",
  );
  if (job.analysis) {
    lines.push(escapeMarkdown(job.analysis.summary), "");
    if (job.analysis.likelyCause)
      lines.push(`**Likely cause** ${escapeMarkdown(job.analysis.likelyCause)}`, "");
  }
  for (const item of job.findings ?? []) {
    if (item.severity !== "info") lines.push(`- ${escapeMarkdown(item.message)}`);
  }
  const deltas = job.regions
    .flatMap((region) => region.deltas)
    .filter((delta) => delta.kind === "style")
    .slice(0, 3);
  if (deltas.length > 0) {
    lines.push("", "**Changes**");
    for (const delta of deltas) {
      if (delta.kind === "style")
        lines.push(
          `- ${inlineCode(delta.selector)} ${inlineCode(`${delta.property}: ${delta.production} → ${delta.staging}`)}`,
        );
    }
  }
  if (job.analysis?.suggestedFix) {
    lines.push("", `**Suggested fix** ${escapeMarkdown(job.analysis.suggestedFix.description)}`);
    if (job.analysis.suggestedFix.snippet)
      lines.push("", codeBlock(job.analysis.suggestedFix.snippet, "diff"));
  }
  lines.push("", "</details>", "");
  return lines;
}

/**
 * Escape HTML-significant characters in text used inside generated markup. Replacement order
 * avoids double-escaping newly inserted entities.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
