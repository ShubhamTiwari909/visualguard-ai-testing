import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTestCommand } from "../src/cli/commands/test.js";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  publish: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../src/core/run.js", async (original) => ({
  ...(await original<typeof import("../src/core/run.js")>()),
  createRun: mocks.create,
}));
vi.mock("../../../apps/platform/server/test-binding.js", () => ({
  prepareTestBinding: mocks.prepare,
}));
vi.mock("../src/core/jobs.js", async (original) => ({
  ...(await original<typeof import("../src/core/jobs.js")>()),
  planJobs: async () => ({ routes: [], jobs: [], warnings: [] }),
}));
vi.mock("../src/cli/shared.js", async (original) => ({
  ...(await original<typeof import("../src/cli/shared.js")>()),
  loadResolvedConfig: async () => ({
    mode: "compare",
    cwd: "/application",
    baseURL: { production: "https://example.test", staging: "https://staging.test" },
    viewports: {},
    routes: [],
  }),
  standardReporters: () => [],
}));

describe("test command project publishing", () => {
  const manifest = (regression = 0) => ({
    summary: { pass: regression ? 0 : 1, accepted: 0, review: 0, regression, error: 0 },
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mocks.create.mockReturnValue({ start: mocks.start });
    mocks.start.mockResolvedValue({
      manifest: manifest(),
      runDir: "/application/custom-output/runs/exact-run",
    });
    mocks.publish.mockResolvedValue({
      id: "saved",
      url: "/runs/saved",
      status: "pass",
      duplicate: false,
    });
    mocks.prepare.mockResolvedValue({
      id: "storefront",
      name: "Storefront",
      destination: "local dashboard storage",
      publish: mocks.publish,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("keeps a plain test offline even when a dashboard URL is configured", async () => {
    vi.stubEnv("VISUALGUARD_DASHBOARD_URL", "https://dashboard.example.test");
    expect(await runTestCommand({ failOn: "regression" })).toBe(0);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("uses the exact captured run directory and keeps failing evidence visible", async () => {
    mocks.start.mockResolvedValue({
      manifest: manifest(1),
      runDir: "/application/custom-output/runs/exact-run",
    });
    vi.stubEnv("VISUALGUARD_DASHBOARD_URL", "https://from-env.example.test");
    expect(
      await runTestCommand({
        project: "Storefront",
        dashboard: "https://explicit.example.test",
        environment: "preview",
        pr: 42,
        failOn: "regression",
        json: true,
      }),
    ).toBe(1);
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "Storefront",
        server: "https://explicit.example.test",
        metadata: expect.objectContaining({ environment: "preview", pullRequest: 42 }),
      }),
    );
    expect(mocks.publish).toHaveBeenCalledWith("/application/custom-output/runs/exact-run");
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("Dashboard run:"));
  });
  it("reports failed publishing without changing a regression into a passing run", async () => {
    mocks.publish.mockRejectedValue(new Error("Dashboard unavailable"));
    expect(await runTestCommand({ project: "storefront", failOn: "regression" })).toBe(3);
    mocks.start.mockResolvedValue({ manifest: manifest(1), runDir: "/saved/run" });
    expect(await runTestCommand({ project: "storefront", failOn: "regression" })).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Saved evidence is kept at: /saved/run"),
    );
  });
  it("rejects invalid project binding before starting capture", async () => {
    mocks.prepare.mockRejectedValue(
      Object.assign(new Error("Project name is ambiguous"), { status: 409 }),
    );
    await expect(
      runTestCommand({ project: "Storefront", failOn: "regression" }),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(mocks.create).not.toHaveBeenCalled();
    await expect(
      runTestCommand({ dashboard: "https://example.test", failOn: "regression" }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
  it("preserves connection guidance and the original cause before capture", async () => {
    const failure = new Error(
      "Cannot reach dashboard at http://127.0.0.1:4400. Start the dashboard in another terminal.",
    );
    mocks.prepare.mockRejectedValue(failure);
    await expect(
      runTestCommand({
        project: "storefront",
        dashboard: "http://127.0.0.1:4400",
        failOn: "regression",
      }),
    ).rejects.toMatchObject({
      exitCode: 3,
      cause: failure,
      message: expect.stringContaining("Start the dashboard in another terminal"),
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps --list free of capture, project creation and upload side effects", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runTestCommand({ project: "storefront", list: true, failOn: "regression" })).toBe(
      0,
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
