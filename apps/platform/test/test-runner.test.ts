import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), upload: vi.fn() }));
vi.mock("../../../packages/visualguard/src/core/run.js", () => ({
  createRun: (_config: unknown, options: unknown) => ({ start: () => mocks.capture(options) }),
}));
vi.mock("../server/upload-client.js", () => ({ uploadRun: mocks.upload }));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
import { runDashboardRunner } from "../server/test-runner.js";

const job = {
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  projectId: "storefront",
  configVersion: 1,
  lease: "a".repeat(64),
  config: {
    baseURL: {
      production: "https://reference.example.test",
      staging: "https://candidate.example.test",
    },
    routes: ["/"],
    viewports: { desktop: { width: 1280, height: 800 } },
    ai: { provider: "none" },
  },
};
describe("runner completion delivery", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "visualguard-runner-review-"));
    mocks.capture.mockResolvedValue({ runDir: root });
    mocks.upload.mockResolvedValue({
      id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      url: "/runs/result",
      status: "review",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  const options = () => ({
    server: "http://127.0.0.1:4400",
    project: "storefront",
    token: "vg_runner_test",
    once: true,
    workDir: root,
  });
  it("retries a lost completion acknowledgement with the same finalized run", async () => {
    const completions: unknown[] = [];
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/claim")) return Response.json(job);
      if (url.pathname.endsWith("/heartbeat")) return Response.json({ ok: true });
      completions.push(JSON.parse(init.body as string));
      if (completions.length === 1) throw new TypeError("response lost after commit");
      return Response.json({ status: "completed" });
    });
    vi.stubGlobal("fetch", fetcher);
    await runDashboardRunner(options());
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(completions).toHaveLength(2);
    expect(completions[0]).toEqual(completions[1]);
    expect(completions[0]).toMatchObject({ runId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" });
    expect(completions[0]).not.toHaveProperty("failed");
  });
  it("retains the uploaded result after persistent completion delivery failure", async () => {
    const completions: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.endsWith("/claim")) return Response.json(job);
        if (url.pathname.endsWith("/heartbeat")) return Response.json({ ok: true });
        completions.push(JSON.parse(init.body as string));
        return new Response("unavailable", { status: 503 });
      }),
    );
    await expect(runDashboardRunner(options())).rejects.toThrow("503");
    expect(completions).toHaveLength(3);
    expect(completions.every((body) => !(body as { failed?: boolean }).failed)).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:4400/runs/result"),
      expect.any(String),
    );
  });
  it("still reports a capture failure when no result was uploaded", async () => {
    mocks.capture.mockRejectedValueOnce(new Error("browser unavailable"));
    const completions: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.endsWith("/claim")) return Response.json(job);
        if (url.pathname.endsWith("/heartbeat")) return Response.json({ ok: true });
        completions.push(JSON.parse(init.body as string));
        return Response.json({ status: "failed" });
      }),
    );
    await expect(runDashboardRunner(options())).rejects.toThrow("browser unavailable");
    expect(completions).toEqual([{ id: job.id, lease: job.lease, failed: true }]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("reports real comparison counts, upload and finalization before completion", async () => {
    const reports: Array<{ stage: string; completedJobs: number; totalJobs: number }> = [];
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.endsWith("/claim")) return Response.json(job);
        const body = JSON.parse(init.body as string);
        if (url.pathname.endsWith("/heartbeat")) {
          reports.push(body.progress);
          order.push(body.progress.stage);
        } else order.push("complete");
        return Response.json({ ok: true });
      }),
    );
    mocks.capture.mockImplementationOnce(async (options) => {
      const event = options.reporters[0].onEvent;
      event({ type: "run:start", jobs: [{ id: "a" }, { id: "b" }] });
      for (const id of ["a", "b"]) {
        event({ type: "job:start", job: { id, route: "/pricing", viewport: "desktop" } });
        event({
          type: "job:captured",
          env: "staging",
          job: { id, route: "/pricing", viewport: "desktop" },
        });
        event({ type: "job:end", job: { id } });
      }
      // A duplicate notification must not double-count a completed comparison.
      event({ type: "job:end", job: { id: "b" } });
      return { runDir: root };
    });
    await runDashboardRunner(options());
    expect(reports).toEqual([
      { stage: "starting", completedJobs: 0, totalJobs: 0 },
      { stage: "uploading", completedJobs: 2, totalJobs: 2 },
      { stage: "finalizing", completedJobs: 2, totalJobs: 2 },
    ]);
    expect(order).toEqual(["starting", "uploading", "finalizing", "complete"]);
  });
  it("serializes and coalesces live reports with lease renewal", async () => {
    let event: (value: unknown) => void = () => {};
    let releaseCapture!: () => void;
    let releaseHeartbeat!: () => void;
    let signalStarted!: () => void;
    let signalHeartbeat!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const heartbeatStarted = new Promise<void>((resolve) => {
      signalHeartbeat = resolve;
    });
    const reports: Array<{ stage: string; completedJobs: number }> = [];
    let active = 0,
      peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.endsWith("/claim")) return Response.json(job);
        if (url.pathname.endsWith("/heartbeat")) {
          const body = JSON.parse(init.body as string);
          reports.push(body.progress);
          peak = Math.max(peak, ++active);
          if (body.progress.stage === "comparing") {
            signalHeartbeat();
            await new Promise<void>((resolve) => {
              releaseHeartbeat = resolve;
            });
          }
          active--;
        } else expect(active).toBe(0);
        return Response.json({ ok: true });
      }),
    );
    mocks.capture.mockImplementationOnce(async (options) => {
      event = options.reporters[0].onEvent;
      event({ type: "run:start", jobs: [{ id: "a" }, { id: "b" }] });
      event({
        type: "job:captured",
        env: "staging",
        job: { id: "a", route: "/", viewport: "desktop" },
      });
      signalStarted();
      await new Promise<void>((resolve) => {
        releaseCapture = resolve;
      });
      return { runDir: root };
    });
    const running = runDashboardRunner(options());
    await started;
    await heartbeatStarted;
    event({ type: "job:end", job: { id: "a" } });
    event({ type: "job:end", job: { id: "b" } });
    releaseCapture();
    releaseHeartbeat();
    await running;
    expect(peak).toBe(1);
    expect(reports.find((value) => value.stage === "comparing")).toMatchObject({
      completedJobs: 0,
    });
    expect(reports.find((value) => value.stage === "uploading")).toMatchObject({
      completedJobs: 2,
    });
  });
  it("does not fail capture for a transient progress-delivery error while its lease is live", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith("/claim")) return Response.json(job);
        if (url.pathname.endsWith("/heartbeat") && first) {
          first = false;
          return new Response("temporarily unavailable", { status: 503 });
        }
        return Response.json({ ok: true });
      }),
    );
    await runDashboardRunner(options());
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it("stops before capture when a progress heartbeat rejects its credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith("/claim")) return Response.json(job);
        if (url.pathname.endsWith("/heartbeat")) return new Response("revoked", { status: 403 });
        return Response.json({ ok: true });
      }),
    );
    await expect(runDashboardRunner(options())).rejects.toThrow("403");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
