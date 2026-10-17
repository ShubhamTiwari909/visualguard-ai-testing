import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Policies } from "../server/policies.js";
import { AuthService, type Actor } from "../server/auth.js";
import { runPolicyCommand } from "../server/policy-command.js";
import { policyPlatform, owner, revision } from "./fixtures/policy-platform.js";

describe("F07 visual regression policy", () => {
  let p: Awaited<ReturnType<typeof policyPlatform>>;
  beforeEach(async () => {
    p = await policyPlatform();
  });
  afterEach(async () => {
    await p?.dispose();
  });
  const assess = () => p.policies.assess(owner, "storefront", revision);
  it("stays pending without policy or evidence and never changes engine results", async () => {
    expect((await assess()).status).toBe("pending");
    await p.save();
    expect((await assess()).status).toBe("pending");
    const run = await p.insert(p.candidate());
    expect((await assess()).status).toBe("blocked");
    await p.approve(run);
    expect(await assess()).toMatchObject({
      status: "satisfied",
      runId: run.id,
      policyVersion: 1,
      baselineVersion: 1,
    });
    expect((await p.repository.getRun(run.id)).status).toBe("regression");
  });
  it("uses pixels rather than AI or local accept status for required visual approval", async () => {
    await p.save();
    const run = p.candidate();
    for (const job of run.manifest.jobs) {
      job.status = "pass";
      job.baseStatus = "regression";
    }
    await p.insert(run);
    expect((await assess()).status).toBe("blocked");
    await p.approve(run);
    expect((await assess()).status).toBe("satisfied");
  });
  it("allows unchanged reliable screenshots without approval", async () => {
    await p.save();
    const run = p.candidate();
    for (const job of run.manifest.jobs) {
      job.diff!.diffPixels = 0;
      job.diff!.diffRatio = 0;
      job.status = "pass";
    }
    await p.insert(run);
    expect((await assess()).status).toBe("satisfied");
  });
  it.each([
    [
      "old source",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.provenance!.sourceRevision = "d".repeat(40);
      },
    ],
    [
      "missing scope",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.jobs.pop();
      },
    ],
    [
      "partial shard",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.shard = { index: 1, total: 2 };
      },
    ],
    [
      "incomplete upload",
      (run: ReturnType<typeof p.candidate>) => {
        run.complete = false;
      },
    ],
    [
      "stale evidence",
      (run: ReturnType<typeof p.candidate>) => {
        run.startedAt = new Date(Date.now() - 25 * 3600000).toISOString();
      },
    ],
    [
      "unreliable capture",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.jobs[0]!.captures.staging!.unstable = true;
      },
    ],
    [
      "truncated capture",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.jobs[0]!.captures.production!.truncated = true;
      },
    ],
    [
      "failed request",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.jobs[0]!.captures.staging!.health.failedRequests.push("/api");
      },
    ],
    [
      "missing artifacts",
      (run: ReturnType<typeof p.candidate>) => {
        run.artifacts = [];
      },
    ],
    [
      "wrong baseline bytes",
      (run: ReturnType<typeof p.candidate>) => {
        run.artifacts[1]!.hash = p.source.artifacts[1]!.hash;
      },
    ],
    [
      "wrong baseline receipt",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.jobs[0]!.captures.production!.approvedReference!.version = 9;
      },
    ],
    [
      "wrong rendering identity",
      (run: ReturnType<typeof p.candidate>) => {
        run.manifest.jobs[0]!.viewport = "mobile";
      },
    ],
  ])("blocks %s even when the visual change is approved", async (_label, change) => {
    await p.save();
    const run = p.candidate();
    change(run);
    const stored = await p.insert(run);
    await p.approve(stored);
    expect((await assess()).status).toBe("blocked");
  });
  it("requires configured critical checks even when expected scope is otherwise complete", async () => {
    await p.save({
      ...p.mutation,
      policy: { ...p.mutation.policy, requiredChecks: ["missing__mobile"] },
    });
    const run = await p.insert(p.candidate());
    await p.approve(run);
    expect((await assess()).reasons.join(" ")).toContain("missing__mobile");
  });
  it("does not transfer a passing assessment to a new commit or another project", async () => {
    await p.save();
    const run = await p.insert(p.candidate());
    await p.approve(run);
    expect((await p.policies.assess(owner, "storefront", "d".repeat(40))).status).toBe("pending");
    await p.repository.createProject("other", "Other");
    await p.policies.save(owner, "other", p.mutation);
    await expect(p.policies.assess(owner, "other", revision, run.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("expires scoped exceptions and never waives an explicit rejection", async () => {
    const run = await p.insert(p.candidate());
    const exceptions = run.manifest.jobs.map((job) => ({
      revision,
      jobId: job.id,
      reason: "Temporary pilot waiver",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }));
    await p.save({ ...p.mutation, policy: { ...p.mutation.policy, exceptions } });
    expect(await assess()).toMatchObject({
      status: "satisfied",
      waivedChecks: run.manifest.jobs.map((job) => job.id),
    });
    await p.approve(run, "reject_visual_change");
    expect((await assess()).status).toBe("blocked");
    const row = (await p.state.get<import("../shared/policies.js").PolicyVersion[]>(
      "visual-policies",
      "storefront",
    ))!;
    for (const item of row.value[0]!.exceptions)
      item.expiresAt = new Date(Date.now() - 1000).toISOString();
    await p.state.replace("visual-policies", row);
    await p.approve(run, "withdraw_decision");
    expect((await assess()).status).toBe("blocked");
  });
  it("preserves version history, rejects stale edits and persists across service restarts", async () => {
    await p.save();
    await expect(p.save()).rejects.toMatchObject({ status: 409 });
    await p.save({
      ...p.mutation,
      expectedVersion: 1,
      reason: "Enable required checks",
      policy: { ...p.mutation.policy, mode: "required" },
    });
    const reopened = new Policies(p.repository, p.state, p.auth);
    expect(
      (await reopened.history(owner, "storefront")).versions.map((item) => item.version),
    ).toEqual([2, 1]);
    expect(
      (
        await runPolicyCommand({
          action: "assess",
          project: "storefront",
          revision,
          env: { VISUALGUARD_PLATFORM_DATA_DIR: p.root },
        })
      ).assessment?.status,
    ).toBe("pending");
  });
  it("enforces roles, repository allowlists and exception expiry limits", async () => {
    const auth = new AuthService(p.state, {
      ...p.env,
      VISUALGUARD_AUTH_MODE: "login",
      VISUALGUARD_PUBLIC_URL: "http://localhost:4400",
    });
    await auth.ready;
    const policies = new Policies(p.repository, p.state, auth);
    const viewer: Actor = { id: "viewer", name: "Viewer", email: "", admin: false, csrf: "" };
    await p.state.create("memberships", "viewer:storefront", {
      userId: "viewer",
      projectId: "storefront",
      role: "viewer",
    });
    await expect(policies.save(viewer, "storefront", p.mutation)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      p.save({ ...p.mutation, policy: { ...p.mutation.policy, repository: "evil/repo" } }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      p.save({
        ...p.mutation,
        policy: {
          ...p.mutation.policy,
          exceptions: [
            {
              revision,
              jobId: "check",
              reason: "No permanent bypass",
              expiresAt: new Date(Date.now() + 8 * 86400000).toISOString(),
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("invalidates approval when its reviewer loses access", async () => {
    await p.save();
    const run = await p.insert(p.candidate());
    const auth = new AuthService(p.state, {
      ...p.env,
      VISUALGUARD_AUTH_MODE: "login",
      VISUALGUARD_PUBLIC_URL: "http://localhost:4400",
    });
    await auth.ready;
    const reviewer: Actor = {
      id: "reviewer",
      name: "Reviewer",
      email: "reviewer@example.test",
      admin: false,
      csrf: "",
    };
    await p.state.create("users", reviewer.id, { ...reviewer, role: "user", disabled: false });
    await p.state.create("memberships", "reviewer:storefront", {
      userId: reviewer.id,
      projectId: "storefront",
      role: "reviewer",
    });
    const { Reviews } = await import("../server/reviews.js");
    const reviews = new Reviews(p.repository, p.state, auth);
    for (const job of run.manifest.jobs) {
      const view = await reviews.read(reviewer, run.id, job.id);
      await reviews.append(reviewer, run.id, {
        jobId: job.id,
        evidenceDigest: run.digest,
        scopeDigest: view.scopeDigest,
        expectedVersion: view.version,
        event: { action: "approve_visual_change", reason: "Reviewed" },
      });
    }
    const policies = new Policies(p.repository, p.state, auth);
    expect((await policies.assess({ ...owner, admin: true }, "storefront", revision)).status).toBe(
      "satisfied",
    );
    await p.state.remove("memberships", "reviewer:storefront");
    expect((await policies.assess(owner, "storefront", revision)).status).toBe("blocked");
  });
});
