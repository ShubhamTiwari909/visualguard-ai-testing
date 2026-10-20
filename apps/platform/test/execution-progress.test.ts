import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionProgress } from "../client/execution-progress.js";
import type { ProjectTestExecution } from "../shared/project-tests.js";
const execution: ProjectTestExecution = {
  id: "request",
  configVersion: 1,
  requestedAt: "2026-10-20T00:00:00Z",
  status: "running",
  progress: {
    stage: "comparing",
    completedJobs: 2,
    totalJobs: 4,
    route: "/pricing",
    viewport: "desktop",
  },
};
const render = (value: ProjectTestExecution) =>
  renderToStaticMarkup(createElement(ExecutionProgress, { execution: value }));
describe("accessible project execution progress", () => {
  it("shows actual comparison counts, stage, route and viewport", () => {
    const html = render(execution);
    for (const value of [
      'aria-live="polite"',
      'aria-label="Comparisons completed"',
      'max="4"',
      'value="2"',
      "2 of 4 comparisons completed",
      "50%",
      "/pricing",
      "desktop",
      "Comparing and analyzing",
    ])
      expect(html).toContain(value);
  });
  it("keeps queued and older-runner executions indeterminate", () => {
    for (const status of ["queued", "running"] as const) {
      const html = render({ ...execution, status, progress: undefined });
      expect(html).toContain("<progress");
      expect(html).not.toContain("value=");
      expect(html).not.toContain("%");
    }
  });
  it("does not claim upload is complete when comparisons reach 100 percent", () => {
    const html = render({
      ...execution,
      progress: { stage: "uploading", completedJobs: 4, totalJobs: 4 },
    });
    expect(html).toContain("Uploading test results");
    expect(html).toContain("4 of 4 comparisons completed");
    expect(html).not.toContain("value=");
    expect(html).not.toContain("100%");
  });
  it("preserves failed progress and exposes failure without an active waiting bar", () => {
    const html = render({ ...execution, status: "failed", error: "Runner disconnected" });
    expect(html).toContain('data-status="failed"');
    expect(html).toContain('value="2"');
    expect(html).toContain("Runner disconnected");
    expect(html).not.toContain("/pricing");
  });
  it("links a finished execution to its actual result without calling it a passing test", () => {
    const html = render({
      ...execution,
      status: "completed",
      runId: "saved-result",
      progress: undefined,
    });
    expect(html).toContain('href="/runs/saved-result"');
    expect(html).toContain("Test finished");
    expect(html).toContain("visual regression and review status");
    expect(html).not.toContain("Test passed");
  });
});
