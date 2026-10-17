import { beforeEach, describe, expect, it } from "vitest";
import { AuthService, MemoryStateStore, type Actor } from "../server/auth.js";
import { Baselines, baselinePromotion } from "../server/baselines.js";
import { Reviews } from "../server/reviews.js";
import { ProjectDirectory } from "../server/project-directory.js";
import type { EvidenceRepository, PlatformRepository } from "../server/storage-contracts.js";
import type { RunDetail } from "../shared/contracts.js";
import { baselineRun } from "./fixtures/baseline-run.js";
import { PlatformError } from "../server/errors.js";

const owner: Actor = {
  id: "local-owner",
  name: "Local workspace",
  email: "",
  admin: true,
  csrf: "",
};
const input = (run: RunDetail, expectedVersion = 0) => ({
  expectedVersion,
  runId: run.id,
  evidenceDigest: run.digest,
  sourceRevision: run.metadata.commit!,
  targetRevision: "b".repeat(40),
  landed: true as const,
  reason: "Reviewed change has landed on main",
});

describe("F04 immutable approved baseline registry", () => {
  let state: MemoryStateStore,
    auth: AuthService,
    service: Baselines,
    reviews: Reviews,
    repository: PlatformRepository;
  let run: RunDetail, runs: Map<string, RunDetail>;
  beforeEach(async () => {
    state = new MemoryStateStore();
    auth = new AuthService(state, { VISUALGUARD_AUTH_MODE: "local" });
    await auth.ready;
    run = baselineRun();
    runs = new Map([[run.id, run]]);
    repository = new ProjectDirectory(
      {
        async getRun(id: string) {
          const item = runs.get(id);
          if (!item) throw new PlatformError(404, "Run not found");
          return structuredClone(item);
        },
        async projects(ids?: string[]) {
          return !ids || ids.includes("storefront")
            ? [
                {
                  id: "storefront",
                  name: "Storefront",
                  runCount: runs.size,
                  createdAt: run.startedAt,
                },
              ]
            : [];
        },
        async deleteRun(id: string) {
          if (!runs.delete(id)) throw new PlatformError(404, "Run not found");
          return { runs: 1, projectId: "storefront" };
        },
        async deleteProject(_id: string, expected: number) {
          if (expected !== runs.size) throw new PlatformError(409, "Run count changed");
          runs.clear();
          return { runs: expected, projectId: "storefront" };
        },
        async isDeletedProject() {
          return false;
        },
      } as unknown as EvidenceRepository,
      state,
    );
    service = new Baselines(repository, state, auth);
    reviews = new Reviews(repository, state, auth);
  });
  const approve = async (reviews: Reviews, run: RunDetail, actor = owner) => {
    for (const job of run.manifest.jobs) {
      const view = await reviews.read(actor, run.id, job.id);
      await reviews.append(actor, run.id, {
        jobId: job.id,
        evidenceDigest: view.evidenceDigest,
        scopeDigest: view.scopeDigest,
        expectedVersion: view.version,
        event: { action: "approve_visual_change", reason: "Intentional pixels" },
      });
    }
  };
  it("requires every exact review and landed revision; records policy, review and actor lineage", async () => {
    await expect(service.promote(owner, "storefront", "main", input(run))).rejects.toThrow(
      "approval",
    );
    await approve(reviews, run);
    expect(baselinePromotion.safeParse({ ...input(run), landed: false }).success).toBe(false);
    const value = await service.promote(owner, "storefront", "main", input(run));
    expect(value).toMatchObject({
      version: 1,
      parentVersion: 0,
      actor: { id: owner.id },
      sourceRevision: run.metadata.commit,
      targetRevision: "b".repeat(40),
      policyVersion: 1,
    });
    expect(value.entries[0]!.review.eventId).toBeTruthy();
    expect((await service.version(owner, "storefront", "main")).version).toBe(1);
    expect(
      (await state.list("audit")).some(
        (row) => (row.value as { action: string }).action === "baseline.promote",
      ),
    ).toBe(true);
  });
  it("allows one concurrent promotion and rejects stale CAS without overwriting history", async () => {
    await approve(reviews, run);
    const results = await Promise.allSettled([
      service.promote(owner, "storefront", "main", input(run)),
      service.promote(owner, "storefront", "main", input(run)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await state.list("baseline-versions")).length).toBe(1);
    await expect(service.promote(owner, "storefront", "main", input(run))).rejects.toMatchObject({
      status: 409,
    });
  });
  it("does not reuse approval on a new run or after withdrawal", async () => {
    await approve(reviews, run);
    const next = baselineRun("22222222-2222-4222-8222-222222222222");
    runs.set(next.id, next);
    await expect(service.promote(owner, "storefront", "main", input(next))).rejects.toThrow(
      "approval",
    );
    const view = await reviews.read(owner, run.id, run.manifest.jobs[0]!.id);
    await reviews.append(owner, run.id, {
      jobId: view.jobId,
      evidenceDigest: view.evidenceDigest,
      scopeDigest: view.scopeDigest,
      expectedVersion: view.version,
      event: { action: "withdraw_decision", reason: "Need another look" },
    });
    await expect(service.promote(owner, "storefront", "main", input(run))).rejects.toThrow(
      "approval",
    );
  });
  it.each([
    "error",
    "incomplete",
    "unstable",
    "truncated",
    "referenceUnstable",
    "referenceTruncated",
    "health",
    "checkError",
    "finding",
    "identity",
    "revision",
  ])("blocks %s evidence despite visual approval", async (kind) => {
    await approve(reviews, run);
    const job = run.manifest.jobs[0]!;
    if (kind === "error") job.error = { stage: "capture", message: "failed" };
    if (kind === "incomplete") run.complete = false;
    if (kind === "unstable") job.captures.staging!.unstable = true;
    if (kind === "truncated") job.captures.staging!.truncated = true;
    if (kind === "referenceUnstable") job.captures.production!.unstable = true;
    if (kind === "referenceTruncated") job.captures.production!.truncated = true;
    if (kind === "health") job.captures.staging!.health.failedRequests.push("/failure");
    if (kind === "checkError") job.captures.staging!.health.checkErrors = ["accessibility failed"];
    if (kind === "finding")
      job.findings = [
        { source: "health", severity: "regression", message: "Performance budget exceeded" },
      ];
    if (kind === "identity") delete job.renderingIdentity;
    if (kind === "revision") run.metadata.commit = "c".repeat(40);
    await expect(
      service.promote(owner, "storefront", "main", input(baselineRun())),
    ).rejects.toMatchObject({ status: 409 });
    expect(await state.list("baseline-heads")).toHaveLength(0);
  });
  it("rejects stale reference pixels and requires explicit coverage changes", async () => {
    await approve(reviews, run);
    await service.promote(owner, "storefront", "main", input(run));
    const next = baselineRun("22222222-2222-4222-8222-222222222222");
    next.digest = "b".repeat(64);
    runs.set(next.id, next);
    await approve(reviews, next);
    await expect(service.promote(owner, "storefront", "main", input(next, 1))).rejects.toThrow(
      "stale reference",
    );
    next.artifacts.find((item) => item.path === "reference.png")!.hash = "1".repeat(64);
    next.manifest.jobs.pop();
    await expect(service.promote(owner, "storefront", "main", input(next, 1))).rejects.toThrow(
      "Coverage changed",
    );
    const value = await service.promote(owner, "storefront", "main", {
      ...input(next, 1),
      coverageChangeReason: "Profile removed intentionally",
    });
    expect(value.entries).toHaveLength(1);
    const restored = await service.restore(owner, "storefront", "main", {
      expectedVersion: 2,
      version: 1,
      reason: "Restore the previous coverage",
    });
    expect(restored).toMatchObject({ version: 3, parentVersion: 2, restoredFrom: 1 });
    expect(restored.entries).toHaveLength(2);
    expect((await service.version(owner, "storefront", "main", 1)).version).toBe(1);
  });
  it("keeps browser/theme/locale variants distinct and refuses silent replacement", async () => {
    await approve(reviews, run);
    const first = await service.promote(owner, "storefront", "main", input(run));
    const next = baselineRun("22222222-2222-4222-8222-222222222222");
    next.digest = "b".repeat(64);
    (
      next.manifest.jobs[0]!.renderingIdentity!.policy.browser as {
        colorScheme: string;
        locale: string;
      }
    ).colorScheme = "dark";
    runs.set(next.id, next);
    await approve(reviews, next);
    await expect(service.promote(owner, "storefront", "main", input(next, 1))).rejects.toThrow(
      "Coverage changed",
    );
    expect(first.entries[0]!.key).not.toEqual(first.entries[1]!.key);
  });
  it("pins source runs, fences deletion, and removes versions only with explicit project deletion", async () => {
    await approve(reviews, run);
    await service.promote(owner, "storefront", "main", input(run));
    await expect(repository.deleteRun(run.id)).rejects.toThrow("retained");
    await expect(repository.deleteProject("storefront", 20)).rejects.toMatchObject({ status: 409 });
    await repository.deleteProject("storefront", 1);
    expect(await state.list("baseline-versions")).toHaveLength(0);
  });
  it("cannot promote after run deletion starts", async () => {
    await approve(reviews, run);
    await state.create("baseline-runs", run.id, { status: "deleting", pinned: false });
    await expect(service.promote(owner, "storefront", "main", input(run))).rejects.toThrow(
      "deleted",
    );
    expect(await state.list("baseline-versions")).toHaveLength(0);
  });
  it("limits upload credentials to reading references in their project", async () => {
    await approve(reviews, run);
    await service.promote(owner, "storefront", "main", input(run));
    const token: Actor = {
      ...owner,
      admin: false,
      credentialId: "token",
      uploadProject: "storefront",
    };
    expect((await service.version(token, "storefront", "main")).version).toBe(1);
    await expect(
      service.version({ ...token, uploadProject: "other" }, "storefront", "main"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.promote(token, "storefront", "main", input(run))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.restore(token, "storefront", "main", {
        expectedVersion: 1,
        version: 1,
        reason: "Denied",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("requires current maintainer access, reviewer membership, and active browser session", async () => {
    const user = {
      id: "maintainer",
      name: "Maintainer",
      email: "member@example.test",
      role: "member",
      disabled: false,
      authVersion: 1,
      createdAt: run.startedAt,
    };
    await state.create("users", user.id, user);
    await state.create("memberships", "maintainer:storefront", {
      userId: user.id,
      projectId: "storefront",
      role: "reviewer",
    });
    const actor = { ...owner, id: user.id, admin: false, sessionId: "session" };
    await approve(reviews, run, actor);
    await expect(service.promote(actor, "storefront", "main", input(run))).rejects.toMatchObject({
      status: 403,
    });
    const membership = (await state.get("memberships", "maintainer:storefront"))!;
    await state.replace("memberships", {
      ...membership,
      value: { ...(membership.value as object), role: "maintainer" },
    });
    await expect(service.promote(actor, "storefront", "main", input(run))).rejects.toMatchObject({
      status: 401,
    });
    await state.create("sessions", "session", { userId: user.id, authVersion: 1 });
    await service.promote(actor, "storefront", "main", input(run));
    const account = (await state.get<typeof user>("users", user.id))!;
    await state.replace("users", { ...account, value: { ...account.value, disabled: true } });
    await expect(
      service.restore(actor, "storefront", "main", {
        expectedVersion: 1,
        version: 1,
        reason: "Denied",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects nontransactional mutations and returns bounded, exclusive history pages", async () => {
    await approve(reviews, run);
    await service.promote(owner, "storefront", "main", input(run));
    for (let n = 1; n <= 21; n++)
      await service.restore(owner, "storefront", "main", {
        expectedVersion: n,
        version: 1,
        reason: "Exercise history",
      });
    const first = await service.history(owner, "storefront", "main");
    const second = await service.history(owner, "storefront", "main", first.nextCursor);
    expect(first.items).toHaveLength(20);
    expect(second.items.map((item) => item.version)).toEqual([21, 22]);
    expect(first.items[0]).not.toHaveProperty("entries");
    state.supportsTransactions = async () => false;
    await expect(
      service.restore(owner, "storefront", "main", {
        expectedVersion: 22,
        version: 1,
        reason: "Denied",
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
