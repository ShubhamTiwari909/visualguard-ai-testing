import { beforeEach, describe, expect, it } from "vitest";
import type { RunDetail } from "../shared/contracts.js";
import type { ReviewThread, ReviewView } from "../shared/reviews.js";
import type { PlatformRepository } from "../server/storage-contracts.js";
import { AuthService, MemoryStateStore, type Actor, type User } from "../server/auth.js";
import { Reviews, reviewMutation, type ReviewMutation } from "../server/reviews.js";
import { PlatformError } from "../server/errors.js";
import { reviewRun } from "./fixtures/review-run.js";

const owner: Actor = { id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: "" };
const account: User = { id: "designer", email: "designer@example.test", name: "Designer", role: "member",
  disabled: false, authVersion: 1, createdAt: "2026-10-15T12:00:00.000Z" };
const designer: Actor = { ...account, admin: false, csrf: "" };
const request = (view: ReviewView, event: ReviewMutation["event"]): ReviewMutation => ({
  jobId: view.jobId, evidenceDigest: view.evidenceDigest, scopeDigest: view.scopeDigest,
  expectedVersion: view.version, event,
});

describe("F03 exact-evidence collaborative reviews", () => {
  let state: MemoryStateStore, auth: AuthService, reviews: Reviews, runs: Map<string, RunDetail>;
  let run: RunDetail;
  beforeEach(async () => {
    state = new MemoryStateStore();
    auth = new AuthService(state, { VISUALGUARD_AUTH_MODE: "local" });
    await auth.ready;
    run = reviewRun();
    runs = new Map([[run.id, run]]);
    const repository = {
      async getRun(id: string) {
        const stored = runs.get(id);
        if (!stored) throw new PlatformError(404, "Run not found");
        return structuredClone(stored);
      },
      async projects(ids?: string[]) {
        return !ids || ids.includes("storefront") ? [{ id: "storefront", name: "Storefront", runCount: 1, createdAt: run.startedAt }] : [];
      },
    } as PlatformRepository;
    reviews = new Reviews(repository, state, auth);
    await state.create("users", account.id, account);
    await state.create("memberships", "designer:storefront", { userId: "designer", projectId: "storefront", role: "reviewer" });
  });

  it("keeps visual decisions separate from independent failures, other checks, and new captures", async () => {
    const original = structuredClone(run);
    const initial = await reviews.read(owner, run.id, "checkout__desktop");
    const approved = await reviews.append(owner, run.id, request(initial, { action: "approve_visual_change", reason: "Intentional color change; the request failure is still open" }));
    expect(approved.status).toBe("approved");
    expect(approved.events[0]?.actor.id).toBe(owner.id);
    expect(approved.evidenceDigest).toBe(run.digest);
    expect(runs.get(run.id)).toEqual(original);
    expect((await reviews.read(owner, run.id, "profile__desktop")).status).toBe("pending");
    const fresh = reviewRun("22222222-2222-4222-8222-222222222222");
    fresh.digest = "b".repeat(64); fresh.metadata.commit = "revision-b";
    runs.set(fresh.id, fresh);
    expect((await reviews.read(owner, fresh.id, "checkout__desktop")).status).toBe("pending");
    await expect(reviews.append(owner, fresh.id, request(approved, { action: "approve_visual_change", reason: "Old approval" }))).rejects.toMatchObject({ status: 409 });
  });

  it("rejects stale versions and preserves both reviewers' intentions through explicit refresh", async () => {
    const first = await reviews.read(owner, run.id, "checkout__desktop");
    const results = await Promise.allSettled([
      reviews.append(owner, run.id, request(first, { action: "approve_visual_change", reason: "Approved after comparison" })),
      reviews.append(designer, run.id, request(first, { action: "reject_visual_change", reason: "Overlap remains" })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure && failure.status === "rejected" && failure.reason.status).toBe(409);
    const latest = await reviews.read(designer, run.id, first.jobId);
    const next = await reviews.append(designer, run.id, request(latest, { action: "reject_visual_change", reason: "After reading the other review, the overlap still needs a fix" }));
    expect(next.events).toHaveLength(2);
    expect(next.events[0]).toEqual(latest.events[0]);
    expect(next.status).toBe("rejected");
  });

  it("requires reviewer permission and revalidates disabled authors and assignees", async () => {
    await state.create("memberships", "viewer:storefront", { role: "viewer", projectId: "storefront" });
    const viewer = { ...designer, id: "viewer" };
    expect((await reviews.read(viewer, run.id, "checkout__desktop")).canReview).toBe(false);
    const first = await reviews.read(designer, run.id, "checkout__desktop");
    await expect(reviews.append(viewer, run.id, request(first, { action: "comment", reason: "Unauthorized" }))).rejects.toMatchObject({ status: 403 });
    await expect(reviews.read({ ...designer, id: "outsider" }, run.id, first.jobId)).rejects.toMatchObject({ status: 403 });
    await expect(reviews.read({ ...owner, credentialId: "upload" }, run.id, first.jobId)).rejects.toMatchObject({ status: 403 });
    const assigned = await reviews.append(owner, run.id, request(first, { action: "assign", reason: "Design review", assigneeId: designer.id, dueAt: "2099-01-01T00:00:00.000Z" }));
    await reviews.append(designer, run.id, request(assigned, { action: "approve_visual_change", reason: "Design approved" }));
    const user = (await state.get<User>("users", designer.id))!;
    await state.replace("users", { ...user, value: { ...user.value, disabled: true } });
    const revoked = await reviews.read(owner, run.id, first.jobId);
    expect(revoked.status).toBe("pending");
    expect(revoked.invalidDecisionReason).toContain("no longer");
    expect(revoked.assigneeAvailable).toBe(false);
    expect(revoked.events).toHaveLength(2);
    expect((await reviews.reviewers(owner, "storefront"))).toEqual([{ id: owner.id, name: owner.name }]);
    await expect(reviews.append(owner, run.id, request(revoked, { action: "assign", reason: "Invalid assignment", assigneeId: designer.id, dueAt: null }))).rejects.toMatchObject({ status: 400 });
  });

  it("keeps comments distinct from decisions, supports replies and explicit withdrawal", async () => {
    let view = await reviews.read(owner, run.id, "checkout__desktop");
    view = await reviews.append(owner, run.id, request(view, { action: "comment", reason: "Please inspect the footer" }));
    expect(view.status).toBe("pending");
    const root = view.events[0]!.id;
    view = await reviews.append(designer, run.id, request(view, { action: "comment", reason: "I can reproduce it", replyTo: root }));
    expect(view.events[1]?.replyTo).toBe(root);
    view = await reviews.append(designer, run.id, request(view, { action: "reject_visual_change", reason: "Footer clips" }));
    expect(view.status).toBe("rejected");
    view = await reviews.append(designer, run.id, request(view, { action: "withdraw_decision", reason: "Rechecking against the design spec" }));
    expect(view.status).toBe("pending");
    expect(view.events).toHaveLength(4);
    await expect(reviews.append(owner, run.id, request(view, { action: "comment", reason: "Cross-thread reply", replyTo: "33333333-3333-4333-8333-333333333333" }))).rejects.toMatchObject({ status: 400 });
  });

  it("refuses visual approval for missing pairs and execution errors but allows discussion", async () => {
    delete run.manifest.jobs[0]!.captures.production;
    let view = await reviews.read(owner, run.id, "checkout__desktop");
    expect(view.visualReviewAvailable).toBe(false);
    await expect(reviews.append(owner, run.id, request(view, { action: "approve_visual_change", reason: "No reference" }))).rejects.toMatchObject({ status: 400 });
    view = await reviews.append(owner, run.id, request(view, { action: "comment", reason: "Need a reference capture" }));
    expect(view.status).toBe("pending");
    run.manifest.jobs[1]!.error = { stage: "capture", message: "Timeout" };
    view = await reviews.read(owner, run.id, "profile__desktop");
    await expect(reviews.append(owner, run.id, request(view, { action: "approve_visual_change", reason: "Cannot approve capture error" }))).rejects.toMatchObject({ status: 400 });
  });

  it("filters assignment inboxes without turning a missing page into a false all-clear", async () => {
    const first = await reviews.read(owner, run.id, "checkout__desktop");
    await reviews.append(owner, run.id, request(first, { action: "assign", reason: "QA review", assigneeId: designer.id, dueAt: null }));
    expect((await reviews.inbox(designer, { project: "storefront", owner: "mine" })).items).toHaveLength(1);
    expect((await reviews.inbox(owner, { project: "storefront", owner: "mine" })).items).toHaveLength(0);
    for (let index = 0; index < 60; index++) {
      const captured = reviewRun(`22222222-2222-4222-8222-${String(index).padStart(12, "0")}`);
      runs.set(captured.id, captured);
      const thread = await reviews.read(owner, captured.id, "checkout__desktop");
      await reviews.append(owner, captured.id, request(thread, { action: "assign", reason: "Review this capture", assigneeId: designer.id, dueAt: null }));
    }
    const page = await reviews.inbox(owner, { project: "storefront", owner: "unassigned" });
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeDefined();
    const next = await reviews.inbox(designer, { project: "storefront", after: page.nextCursor, owner: "mine" });
    expect(next.items.length).toBeGreaterThan(0);
    await expect(reviews.inbox(owner, { project: "storefront", after: "other:run" })).rejects.toMatchObject({ status: 400 });
    runs.clear();
    expect((await reviews.inbox(owner, { project: "storefront" })).items).toHaveLength(0);
  });

  it("marks overdue unresolved assignments and enforces reason, schema, and deadline boundaries", async () => {
    let view = await reviews.read(owner, run.id, "checkout__desktop");
    await expect(reviews.append(owner, run.id, request(view, { action: "assign", reason: "Expired", assigneeId: designer.id, dueAt: "2000-01-01T00:00:00.000Z" }))).rejects.toMatchObject({ status: 400 });
    await expect(reviews.append(owner, run.id, request(view, { action: "assign", reason: "No owner", assigneeId: null, dueAt: "2099-01-01T00:00:00.000Z" }))).rejects.toMatchObject({ status: 400 });
    view = await reviews.append(owner, run.id, request(view, { action: "assign", reason: "Review today", assigneeId: designer.id, dueAt: null }));
    const [row] = await state.list<ReviewThread>("reviews");
    row!.value.events[0]!.dueAt = "2000-01-01T00:00:00.000Z";
    await state.replace("reviews", row!);
    expect((await reviews.inbox(owner, { project: "storefront", overdue: true })).items).toHaveLength(1);
    expect(reviewMutation.safeParse(request(view, { action: "comment", reason: " " })).success).toBe(false);
    expect(reviewMutation.safeParse({ ...request(view, { action: "comment", reason: "x" }), event: { action: "grant_policy_exception", reason: "No policy yet" } }).success).toBe(false);
  });

  it("makes memory-store compare-and-swap atomic and pages live keys exclusively", async () => {
    expect(await Promise.all([state.create("race", "a", {}), state.create("race", "a", {})])).toEqual([true, false]);
    const prior = (await state.get("race", "a"))!;
    expect(await Promise.all([state.replace("race", prior), state.replace("race", prior)])).toEqual([true, false]);
    await state.create("race", "b", {}, "2000-01-01T00:00:00.000Z");
    await state.create("race", "c", {});
    expect((await state.list("race", "", 1, "a")).map((item) => item.id)).toEqual(["c"]);
  });
  it("allows withdrawing a decision even when the discussion is full", async () => {
    let view = await reviews.read(owner, run.id, "checkout__desktop");
    view = await reviews.append(owner, run.id, request(view, { action: "approve_visual_change", reason: "Initial review" }));
    const [row] = await state.list<ReviewThread>("reviews");
    for (let index = 1; index < 200; index++) row!.value.events.push({
      id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
      actor: { id: owner.id, name: owner.name }, at: run.startedAt, action: "comment", reason: `Follow-up ${index}`,
    });
    await state.replace("reviews", row!);
    view = await reviews.read(owner, run.id, view.jobId);
    await expect(reviews.append(owner, run.id, request(view, { action: "comment", reason: "Over limit" }))).rejects.toMatchObject({ status: 413 });
    const withdrawn = await reviews.append(owner, run.id, request(view, { action: "withdraw_decision", reason: "Further inspection found a defect" }));
    expect(withdrawn.status).toBe("pending");
    expect(withdrawn.events).toHaveLength(201);
  });

  it("removes a just-written thread if the run disappears during the write", async () => {
    const initial = await reviews.read(owner, run.id, "checkout__desktop");
    let reads = 0;
    const racingRepository = {
      async getRun() {
        if (++reads > 1) throw new PlatformError(404, "Run deleted concurrently");
        return structuredClone(run);
      },
    } as PlatformRepository;
    const raced = new Reviews(racingRepository, state, auth);
    await expect(raced.append(owner, run.id, request(initial, { action: "comment", reason: "Deletion raced this comment" }))).rejects.toMatchObject({ status: 404 });
    expect(await state.list("reviews")).toEqual([]);
  });
});
