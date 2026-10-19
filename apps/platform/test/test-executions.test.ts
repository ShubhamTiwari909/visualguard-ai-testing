import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ProjectTests } from "../server/project-tests.js";
import { TestExecutions } from "../server/test-executions.js";
import { openPlatform } from "../server/config.js";
import { owner, policyPlatform } from "./fixtures/policy-platform.js";
const config = { baseURL: { production: "https://reference.test", staging: "https://candidate.test" }, routes: ["/"], viewports: { desktop: { width: 1280, height: 800 } }, ai: { provider: "none" as const } };

describe("dashboard test execution lifecycle", () => {
  let p: Awaited<ReturnType<typeof policyPlatform>>, settings: ProjectTests, jobs: TestExecutions;
  let token: Awaited<ReturnType<typeof p.auth.mintToken>>, runnerId: string;
  const request = () => jobs.request(owner, "storefront", { id: randomUUID(), configVersion: 1 });
  beforeEach(async () => {
    p = await policyPlatform(); settings = new ProjectTests(p.repository, p.state, p.auth); jobs = new TestExecutions(settings);
    await settings.save(owner, "storefront", { expectedVersion: 0, config });
    token = await p.auth.mintToken(owner, "storefront", "Private runner", 30, true);
    const actor = await p.auth.actor({ headers: { authorization: `Bearer ${token.token}` } } as IncomingMessage);
    runnerId = await jobs.runner(actor!, "storefront", token.token);
  });
  afterEach(async () => p.dispose());
  it("requires a connected runner and rejects stale configuration", async () => {
    await expect(request()).rejects.toMatchObject({ status: 409 });
    await jobs.claim("storefront", runnerId);
    await expect(jobs.request(owner, "storefront", { id: randomUUID(), configVersion: 2 })).rejects.toMatchObject({ status: 409 });
    expect((await request()).status).toBe("queued");
  });
  it("admits one request and one claim across concurrent workers, preserving the exact config snapshot", async () => {
    await jobs.claim("storefront", runnerId);
    const requested = await Promise.allSettled([request(), request()]);
    expect(requested.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    await settings.save(owner, "storefront", { expectedVersion: 1, config: { ...config, baseURL: { ...config.baseURL, staging: "https://updated.test" } } });
    const claims = await Promise.all([jobs.claim("storefront", runnerId), jobs.claim("storefront", runnerId)]);
    const claimed = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claimed.config.baseURL.staging).toBe("https://candidate.test");
    expect(claimed.configVersion).toBe(1);
    const visible = JSON.stringify(await jobs.status(owner, "storefront"));
    expect(visible).not.toContain(claimed.lease);
    expect(visible).not.toContain("leaseHash");
    expect(visible).not.toContain("runnerId");
  });
  it("claims a durable request from another dashboard connection", async () => {
    await jobs.claim("storefront", runnerId);
    const requested = await request();
    const other = await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: p.root });
    try {
      const restarted = new TestExecutions(new ProjectTests(other.repository, other.state, p.auth));
      expect((await restarted.claim("storefront", runnerId))?.id).toBe(requested.id);
      expect(await jobs.claim("storefront", runnerId)).toBeNull();
    } finally { await other.close(); }
  });
  it("is idempotent for the same request ID and rejects leases belonging to another worker", async () => {
    await jobs.claim("storefront", runnerId);
    const job = await request();
    expect((await jobs.request(owner, "storefront", { id: job.id, configVersion: 1 })).id).toBe(job.id);
    const claimed = (await jobs.claim("storefront", runnerId))!;
    await expect(jobs.heartbeat("storefront", "other", { id: claimed.id, lease: claimed.lease })).rejects.toMatchObject({ status: 409 });
    await expect(jobs.complete("storefront", runnerId, { id: claimed.id, lease: "0".repeat(64), failed: true })).rejects.toMatchObject({ status: 409 });
  });
  it("expires a disconnected execution, rejects late completion and permits an explicit new request", async () => {
    await jobs.claim("storefront", runnerId); await request();
    const claimed = (await jobs.claim("storefront", runnerId))!;
    const row = (await p.state.get<Record<string, unknown>>("project-test-executions", "storefront"))!;
    await p.state.replace("project-test-executions", { ...row, value: { ...row.value, leaseExpiresAt: "2000-01-01T00:00:00.000Z" } });
    expect((await jobs.status(owner, "storefront")).execution?.status).toBe("failed");
    await expect(jobs.complete("storefront", runnerId, { id: claimed.id, lease: claimed.lease, failed: true })).rejects.toMatchObject({ status: 409 });
    expect((await request()).id).not.toBe(claimed.id);
  });
  it("accepts only a published run linked to this execution and preserves regression evidence as the result", async () => {
    await jobs.claim("storefront", runnerId); await request();
    const claimed = (await jobs.claim("storefront", runnerId))!;
    await expect(jobs.complete("storefront", runnerId, { id: claimed.id, lease: claimed.lease, runId: p.source.id })).rejects.toMatchObject({ status: 409 });
    const engineId = randomUUID(), candidate = p.candidate();
    const run = await p.insert({ ...candidate, id: randomUUID(), engineRunId: engineId, digest: "a".repeat(64), manifest: { ...candidate.manifest, id: engineId }, metadata: { environment: "dashboard", deployment: claimed.id } });
    await jobs.heartbeat("storefront", runnerId, { id: claimed.id, lease: claimed.lease });
    expect(await jobs.complete("storefront", runnerId, { id: claimed.id, lease: claimed.lease, runId: run.id })).toMatchObject({ status: "completed", runId: run.id });
    expect((await p.repository.getRun(run.id)).status).toBe(candidate.status);
    expect(await jobs.complete("storefront", runnerId, { id: claimed.id, lease: claimed.lease, runId: run.id })).toMatchObject({ status: "completed", runId: run.id });
  });
  it("rejects ordinary upload credentials, revoked runners and cross-project credentials", async () => {
    const normal = await p.auth.mintToken(owner, "storefront", "Upload only", 30);
    await expect(jobs.runner(owner, "storefront", normal.token)).rejects.toMatchObject({ status: 403 });
    const actor = (await p.auth.actor({ headers: { authorization: `Bearer ${token.token}` } } as IncomingMessage))!;
    await expect(jobs.runner(actor, "other", token.token)).rejects.toMatchObject({ status: 403 });
    await expect(settings.save(actor, "storefront", { expectedVersion: 1, config })).rejects.toMatchObject({ status: 403 });
    await p.auth.revokeToken(owner, "storefront", token.id);
    await expect(jobs.runner(actor, "storefront", token.token)).rejects.toMatchObject({ status: 403 });
  });
  it("enforces maintainer request authority and deletes queued work with the project", async () => {
    await p.state.create("memberships", "viewer:storefront", { userId: "viewer", projectId: "storefront", role: "viewer" });
    const viewer = { ...owner, admin: false, id: "viewer" };
    await jobs.claim("storefront", runnerId);
    await expect(jobs.request(viewer, "storefront", { id: randomUUID(), configVersion: 1 })).rejects.toMatchObject({ status: 403 });
    await request();
    await p.repository.deleteProject("storefront", (await p.repository.projects(["storefront"]))[0]!.runCount);
    expect(await p.state.get("project-test-executions", "storefront")).toBeUndefined();
    expect(await p.state.get("project-runner-heartbeats", "storefront")).toBeUndefined();
    expect(await p.state.get("tokens", token.id)).toBeUndefined();
  });
});
