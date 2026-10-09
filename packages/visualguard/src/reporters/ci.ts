import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Reporter } from "../core/run.js";
import { isFailing } from "../core/status.js";
import type { FailOn, JobResult, RunManifest } from "../core/types.js";
import { renderMarkdown } from "./markdown.js";

const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function failureMessage(job: JobResult): string {
  if (job.analysis) return job.analysis.title;
  const finding = job.findings?.find((item) => item.severity !== "info");
  return (
    finding?.message ??
    `${job.status}: ${((job.diff?.diffRatio ?? 0) * 100).toFixed(2)}% of pixels changed`
  );
}

/** JUnit XML: one testcase per route × viewport, failing per `--fail-on` (PLAN.md §12.1). */
export function renderJUnit(manifest: RunManifest, failOn: FailOn): string {
  const cases = manifest.jobs.map((job) => {
    const name = xml(`${job.route} (${job.viewport})`);
    const time = (job.durationMs / 1000).toFixed(3);
    const open = `    <testcase classname="visualguard.${xml(job.viewport)}" name="${name}" time="${time}">`;
    if (job.error) {
      return `${open}\n      <error message="${xml(job.error.message.split("\n")[0]!)}" type="${job.error.stage}">${xml(job.error.message)}</error>\n    </testcase>`;
    }
    if (isFailing(job.status, failOn)) {
      const details = [
        `status: ${job.status}`,
        `production: ${job.urls.production}`,
        `staging: ${job.urls.staging}`,
        ...(job.findings ?? []).map((finding) => `${finding.severity}: ${finding.message}`),
      ].join("\n");
      return `${open}\n      <failure message="${xml(failureMessage(job))}" type="${job.status}">${xml(details)}</failure>\n    </testcase>`;
    }
    const note =
      job.status === "accepted"
        ? "accepted change"
        : job.status === "review"
          ? failureMessage(job)
          : "";
    return note
      ? `${open}\n      <system-out>${xml(note)}</system-out>\n    </testcase>`
      : `${open}</testcase>`;
  });
  const failures = manifest.jobs.filter(
    (job) => !job.error && isFailing(job.status, failOn),
  ).length;
  const errors = manifest.jobs.filter((job) => job.error).length;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="VisualGuard" tests="${manifest.jobs.length}" failures="${failures}" errors="${errors}" time="${(manifest.durationMs / 1000).toFixed(3)}">`,
    `  <testsuite name="VisualGuard run #${manifest.number}" tests="${manifest.jobs.length}" failures="${failures}" errors="${errors}" timestamp="${manifest.startedAt}">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

export function junitReporter(path: string, failOn: FailOn): Reporter {
  return {
    name: "junit",
    onRunEnd(manifest) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, renderJUnit(manifest, failOn));
    },
  };
}

/** Appends the Markdown summary to $GITHUB_STEP_SUMMARY; needs no token (PLAN.md §12.2). */
export function githubSummaryReporter(summaryPath: string, reportURL?: string): Reporter {
  return {
    name: "github-summary",
    onRunEnd(manifest) {
      appendFileSync(summaryPath, `${renderMarkdown(manifest, { reportURL })}\n`);
    },
  };
}

/**
 * POSTs a JSON summary to a URL (n8n, Slack workflows, Zapier…) without the core depending on
 * any of them (PLAN.md §12.7). Failures are reported as warnings, never as run failures.
 */
export function webhookReporter(
  url: string,
  options: { reportURL?: string; warn?: (message: string) => void } = {},
): Reporter {
  return {
    name: "webhook",
    async onRunEnd(manifest) {
      const { summary } = manifest;
      const problems = manifest.jobs.filter(
        (job) => job.status === "regression" || job.status === "error" || job.status === "review",
      );
      const site = manifest.config.baseURL.staging ?? manifest.config.baseURL.production ?? "";
      const body = {
        tool: "visualguard",
        // A one-line summary, so Slack incoming webhooks can take the payload as is.
        text: [
          `VisualGuard ${manifest.mode === "monitor" ? "monitor" : "run"} #${manifest.number} on ${site}: ${summary.regression} regression${summary.regression === 1 ? "" : "s"}, ${summary.review} to review, ${summary.pass + summary.accepted} passed${summary.error ? `, ${summary.error} errors` : ""}.`,
          ...problems
            .slice(0, 5)
            .map(
              (job) =>
                `• ${job.status} ${job.route} (${job.viewport})${job.analysis?.title ? `: ${job.analysis.title}` : ""}`,
            ),
          options.reportURL ? `Report: ${options.reportURL}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        run: {
          id: manifest.id,
          number: manifest.number,
          startedAt: manifest.startedAt,
          durationMs: manifest.durationMs,
        },
        mode: manifest.mode,
        baseURL: manifest.config.baseURL,
        summary: manifest.summary,
        reportURL: options.reportURL,
        jobs: manifest.jobs
          .filter((job) => job.status !== "pass")
          .map((job) => ({
            route: job.route,
            viewport: job.viewport,
            status: job.status,
            title:
              job.analysis?.title ??
              job.findings?.find((item) => item.severity !== "info")?.message,
            urls: job.urls,
          })),
      };
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "visualguard" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) options.warn?.(`Webhook responded with HTTP ${response.status}`);
        await response.body?.cancel();
      } catch (error) {
        options.warn?.(`Webhook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
