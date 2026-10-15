import type { RunDetail } from "../../shared/contracts.js";

export function reviewRun(id = "11111111-1111-4111-8111-111111111111"): RunDetail {
  const capture = {
    image: "candidate.png", size: { width: 100, height: 100 }, durationMs: 1, attempts: 1,
    health: { consoleErrors: [], failedRequests: ["/api/checkout"], brokenImages: [] },
  };
  const job: RunDetail["manifest"]["jobs"][number] = {
    id: "checkout__desktop", route: "/checkout", name: "Checkout", viewport: "desktop",
    status: "regression", durationMs: 1,
    urls: { production: "https://example.test", staging: "https://staging.example.test" },
    captures: { production: { ...capture, image: "reference.png" }, staging: capture },
    diff: { width: 100, height: 100, diffPixels: 50, diffRatio: 0.005 }, regions: [],
    findings: [{ severity: "regression", source: "health", message: "Failed request: /api/checkout" }],
  };
  const summary = { pass: 0, accepted: 0, review: 0, regression: 2, error: 0 };
  return {
    id, projectId: "storefront", engineRunId: `engine-${id}`, number: 1,
    startedAt: "2026-10-15T12:00:00.000Z", importedAt: "2026-10-15T12:00:01.000Z",
    durationMs: 2, mode: "compare", status: "regression", complete: true, completenessReasons: [],
    summary, metadata: { environment: "staging", commit: "revision-a", branch: "main" },
    digest: "a".repeat(64), jobCount: 2, envelopeVersion: 1, artifacts: [],
    manifest: {
      schemaVersion: 1, id: `engine-${id}`, number: 1, startedAt: "2026-10-15T12:00:00.000Z",
      durationMs: 2, mode: "compare", tool: { version: "3.1.0", node: "22" },
      config: { baseURL: {}, viewports: { desktop: { width: 100, height: 100 } }, ai: { provider: "none" }, failOn: "regression" },
      summary, jobs: [job, { ...structuredClone(job), id: "profile__desktop", name: "Profile", route: "/profile" }],
    },
  };
}

