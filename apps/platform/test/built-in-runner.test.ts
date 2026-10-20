import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ProjectTests } from "../server/project-tests.js";
import { TestExecutions } from "../server/test-executions.js";
import { BuiltInRunner, builtInRunnerEnabled } from "../server/built-in-runner.js";
import { owner, policyPlatform } from "./fixtures/policy-platform.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), importRun: vi.fn() }));
vi.mock("../server/test-runner.js", () => ({ executeClaimedTest: mocks.execute }));
vi.mock("../server/ingest.js", async (original) => ({
  ...(await original<typeof import("../server/ingest.js")>()),
  importRun: mocks.importRun,
}));

const config = {
  baseURL: { production: "https://reference.test", staging: "https://candidate.test" },
  routes: ["/"],
  viewports: { desktop: { width: 1280, height: 800 } },
  ai: { provider: "none" as const },
};
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("built-in dashboard test runner", () => {
  let p: Awaited<ReturnType<typeof policyPlatform>>, jobs: TestExecutions, runner: BuiltInRunner;
  const request = () => jobs.request(owner, "storefront", { id: randomUUID(), configVersion: 1 });
  beforeEach(async () => {
    p = await policyPlatform();
    jobs = new TestExecutions(new ProjectTests(p.repository, p.state, p.auth));
    await new ProjectTests(p.repository, p.state, p.auth).save(owner, "storefront", {
      expectedVersion: 0,
      config,
    });
    runner = new BuiltInRunner(jobs, p.repository, {} as never, { enabled: true });
    jobs.builtIn = runner;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await p.dispose();
  });

  it("runs a requested test without any runner credential", async () => {
    mocks.execute.mockImplementation(async (job, io) => {
      const engineId = randomUUID(),
        candidate = p.candidate();
      const run = await p.insert({
        ...candidate,
        id: randomUUID(),
        engineRunId: engineId,
        digest: "a".repeat(64),
        manifest: { ...candidate.manifest, id: engineId },
        metadata: { environment: "dashboard", deployment: job.id },
      });
      mocks.importRun.mockResolvedValueOnce({ run });
      const result = await io.transport.upload({ runDir: "/tmp/x", signal: new AbortController().signal, metadata: {} as never });
      await io.transport.complete({ id: job.id, lease: job.lease, runId: result.id });
    });
    expect((await jobs.status(owner, "storefront")).builtInRunner).toBe(true);
    const requested = await request();
    await settled();
    const status = (await jobs.status(owner, "storefront")).execution;
    expect(status).toMatchObject({ id: requested.id, status: "completed" });
    expect(status?.runId).toBeTruthy();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    // The built-in worker is not mistaken for a connected private runner.
    expect((await jobs.status(owner, "storefront")).runnerOnline).toBe(false);
  });

  it("explains a missing browser and releases the project", async () => {
    mocks.execute.mockImplementation(async (job, io) => {
      expect(io.failureReason(new Error("browserType.launch: Executable doesn't exist"))).toBe(
        "browser-unavailable",
      );
      expect(io.failureReason(new Error("Navigation timeout"))).toBeUndefined();
      await io.transport.complete({
        id: job.id,
        lease: job.lease,
        failed: true,
        reason: "browser-unavailable",
      });
    });
    await request();
    await settled();
    const { execution } = await jobs.status(owner, "storefront");
    expect(execution?.status).toBe("failed");
    expect(execution?.error).toContain("playwright install chromium");
    expect((await request()).status).toBe("queued");
  });

  it("stays unavailable when disabled and respects its concurrency limit", async () => {
    jobs.builtIn = new BuiltInRunner(jobs, p.repository, {} as never, { enabled: false });
    await expect(request()).rejects.toMatchObject({ status: 409 });
    expect(mocks.execute).not.toHaveBeenCalled();
    jobs.builtIn = { enabled: true, hasCapacity: false, start: vi.fn() };
    await expect(request()).rejects.toThrow("another test");
  });

  it("is on by default except on serverless hosts, and can be switched explicitly", () => {
    expect(builtInRunnerEnabled({})).toBe(true);
    expect(builtInRunnerEnabled({ VERCEL: "1" })).toBe(false);
    expect(builtInRunnerEnabled({ VERCEL: "1", VISUALGUARD_BUILT_IN_RUNNER: "on" })).toBe(true);
    expect(builtInRunnerEnabled({ VISUALGUARD_BUILT_IN_RUNNER: "off" })).toBe(false);
  });
});
