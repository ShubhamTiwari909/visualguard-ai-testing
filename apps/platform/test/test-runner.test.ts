import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ capture: vi.fn(), upload: vi.fn() }));
vi.mock("../../../packages/visualguard/src/core/run.js", () => ({ createRun: () => ({ start: mocks.capture }) }));
vi.mock("../server/upload-client.js", () => ({ uploadRun: mocks.upload }));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
import { runDashboardRunner } from "../server/test-runner.js";

const job = {
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", projectId: "storefront", configVersion: 1,
  lease: "a".repeat(64),
  config: { baseURL: { production: "https://reference.example.test", staging: "https://candidate.example.test" }, routes: ["/"], viewports: { desktop: { width: 1280, height: 800 } }, ai: { provider: "none" } },
};
describe("runner completion delivery", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "visualguard-runner-review-"));
    mocks.capture.mockResolvedValue({ runDir: root });
    mocks.upload.mockResolvedValue({ id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", url: "/runs/result", status: "review" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); await rm(root, { recursive: true, force: true }); });
  const options = () => ({ server: "http://127.0.0.1:4400", project: "storefront", token: "vg_runner_test", once: true, workDir: root });
  it("retries a lost completion acknowledgement with the same finalized run", async () => {
    const completions: unknown[] = [];
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/claim")) return Response.json(job);
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
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/claim")) return Response.json(job);
      completions.push(JSON.parse(init.body as string));
      return new Response("unavailable", { status: 503 });
    }));
    await expect(runDashboardRunner(options())).rejects.toThrow("503");
    expect(completions).toHaveLength(3);
    expect(completions.every((body) => !(body as { failed?: boolean }).failed)).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:4400/runs/result"), expect.any(String));
  });
  it("still reports a capture failure when no result was uploaded", async () => {
    mocks.capture.mockRejectedValueOnce(new Error("browser unavailable"));
    const completions: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (url.pathname.endsWith("/claim")) return Response.json(job);
      completions.push(JSON.parse(init.body as string));
      return Response.json({ status: "failed" });
    }));
    await expect(runDashboardRunner(options())).rejects.toThrow("browser unavailable");
    expect(completions).toEqual([{ id: job.id, lease: job.lease, failed: true }]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
