import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PolicyGitHub } from "../server/policy-github.js";
import { policyPlatform, owner, revision } from "./fixtures/policy-platform.js";

describe("F07 exact revision GitHub reconciliation", () => {
  let p: Awaited<ReturnType<typeof policyPlatform>>;
  let github: PolicyGitHub;
  let calls: { path: string; method: string; body: Record<string, unknown> }[];
  let checks: {
    id: number;
    html_url: string;
    external_id: string;
    name: string;
    status: string;
    conclusion?: string;
  }[];
  let head: string, branch: string, state: string;
  let fail: ((path: string, method: string) => Response | undefined) | undefined;
  let afterPatch: (() => Promise<void>) | undefined;
  let ambiguousCreate: boolean;
  beforeEach(async () => {
    p = await policyPlatform();
    await p.save();
    const run = await p.insert(p.candidate());
    await p.approve(run);
    calls = [];
    checks = [];
    head = revision;
    branch = "main";
    state = "open";
    fail = undefined;
    afterPatch = undefined;
    ambiguousCreate = false;
    const mock: typeof fetch = async (url, options) => {
      const path = new URL(String(url)).pathname + new URL(String(url)).search;
      const method = options?.method ?? "GET";
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      calls.push({ path, method, body });
      expect(new Headers(options?.headers).get("authorization")).toBe("Bearer test-only-secret");
      const failure = fail?.(path, method);
      if (failure) return failure;
      if (path.endsWith("/pulls/7"))
        return Response.json({ state, head: { sha: head }, base: { ref: branch } });
      if (path.includes("/commits/")) return Response.json({ check_runs: checks });
      if (method === "POST" && path.endsWith("/check-runs")) {
        const check = {
          ...body,
          id: checks.length + 1,
          html_url: `https://github.com/acme/store/checks/${checks.length + 1}`,
        };
        checks.push(check);
        if (ambiguousCreate) {
          ambiguousCreate = false;
          throw new Error("response lost after GitHub saved check");
        }
        return Response.json(check);
      }
      if (method === "PATCH") {
        const check = checks.find((item) => item.id === Number(path.split("/").at(-1)))!;
        Object.assign(check, body);
        if (afterPatch && body.status === "completed") {
          const callback = afterPatch;
          afterPatch = undefined;
          await callback();
        }
        return Response.json(check);
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    };
    github = new PolicyGitHub(p.policies, mock);
  });
  afterEach(async () => {
    await p?.dispose();
  });
  it("publishes an informative exact-commit check and reuses its external ID", async () => {
    const result = await github.reconcile(owner, "storefront", 7);
    expect(result.assessment?.status).toBe("satisfied");
    expect(checks[0]).toMatchObject({
      status: "completed",
      conclusion: "neutral",
      external_id: `visualguard:storefront:${revision}`,
    });
    expect(calls.find((item) => item.method === "POST")?.body.head_sha).toBe(revision);
    await github.reconcile(owner, "storefront", 7);
    expect(checks).toHaveLength(1);
    expect((await github.deliveries(owner, "storefront"))[0]?.checkId).toBe(1);
  });
  it("reports required success then failure when a reviewer withdraws", async () => {
    await p.save({
      ...p.mutation,
      expectedVersion: 1,
      policy: { ...p.mutation.policy, mode: "required" },
    });
    await github.reconcile(owner, "storefront", 7);
    expect(checks[0]?.conclusion).toBe("success");
    const run = await p.repository.getRun(
      (await p.policies.assess(owner, "storefront", revision)).runId!,
    );
    await p.approve(run, "withdraw_decision");
    await github.reconcile(owner, "storefront", 7);
    expect(checks[0]?.conclusion).toBe("failure");
  });
  it("never inherits success for a new head without evidence", async () => {
    await p.save({
      ...p.mutation,
      expectedVersion: 1,
      policy: { ...p.mutation.policy, mode: "required" },
    });
    await github.reconcile(owner, "storefront", 7);
    head = "d".repeat(40);
    const result = await github.reconcile(owner, "storefront", 7);
    expect(result.assessment?.status).toBe("pending");
    expect(checks[1]?.status).toBe("in_progress");
  });
  it("requires evidence bound to the PR even when the revision has a passing run", async () => {
    const run = p.candidate();
    run.metadata.pullRequest = 8;
    run.startedAt = new Date(Date.now() + 1000).toISOString();
    // Remove the PR-7 candidate, leaving only valid PR-8 evidence.
    const old = (await p.policies.assess(owner, "storefront", revision)).runId!;
    await p.repository.deleteRun(old);
    await p.insert(run);
    await p.approve(run);
    const result = await github.reconcile(owner, "storefront", 7);
    expect(result.assessment?.status).toBe("pending");
    expect(result.assessment?.runId).toBeUndefined();
  });
  it("recovers an ambiguous create without duplicate check runs", async () => {
    ambiguousCreate = true;
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 502 });
    expect((await github.deliveries(owner, "storefront"))[0]?.error).toContain("interrupted");
    await github.reconcile(owner, "storefront", 7);
    expect(checks).toHaveLength(1);
    expect((await github.deliveries(owner, "storefront"))[0]?.error).toBeUndefined();
  });
  it("retries transient reads and leaves known success pending on an outage", async () => {
    let attempts = 0;
    fail = (path) =>
      path.endsWith("/pulls/7") && attempts++ < 2 ? new Response("", { status: 503 }) : undefined;
    await github.reconcile(owner, "storefront", 7);
    expect(attempts).toBeGreaterThanOrEqual(3);
    fail = (path, method) =>
      method === "GET" && path.endsWith("/pulls/7") ? new Response("", { status: 503 }) : undefined;
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 502 });
    expect(checks[0]?.status).toBe("in_progress");
  });
  it("invalidates delivery if a review changes while the result is being published", async () => {
    afterPatch = async () => {
      const run = await p.repository.getRun(
        (await p.policies.assess(owner, "storefront", revision)).runId!,
      );
      await p.approve(run, "withdraw_decision");
    };
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 409 });
    expect(checks[0]?.status).toBe("in_progress");
  });
  it("invalidates a passing delivery if newer PR evidence arrives during publication", async () => {
    afterPatch = async () => {
      const newer = p.candidate();
      newer.startedAt = new Date(Date.now() + 1000).toISOString();
      newer.complete = false;
      await p.insert(newer);
    };
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 409 });
    expect(checks[0]?.status).toBe("in_progress");
  });
  it("does not let an expired worker overwrite the newer lease owner's result", async () => {
    afterPatch = async () => {
      await p.state.remove("policy-locks", "storefront");
      await p.state.create(
        "policy-locks",
        "storefront",
        { owner: "new-worker" },
        new Date(Date.now() + 60000).toISOString(),
      );
    };
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 409 });
    expect(checks[0]?.status).toBe("completed");
    expect((await p.state.get<{ owner: string }>("policy-locks", "storefront"))?.value.owner).toBe(
      "new-worker",
    );
  });
  it("leaves the check pending when the PR head changes during assessment", async () => {
    let reads = 0;
    fail = (path) => {
      if (path.endsWith("/pulls/7") && ++reads === 2) head = "d".repeat(40);
      return undefined;
    };
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 409 });
    expect(checks[0]?.status).toBe("in_progress");
  });
  it("rejects a policy/PR branch mismatch and serializes delivery across instances", async () => {
    branch = "release";
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 409 });
    expect(checks).toHaveLength(0);
    await p.state.create(
      "policy-locks",
      "storefront",
      { owner: "another-worker" },
      new Date(Date.now() + 60000).toISOString(),
    );
    await expect(github.reconcile(owner, "storefront", 7)).rejects.toMatchObject({ status: 409 });
  });
  it("validates signed webhooks, tolerates duplicate events and records closed PRs", async () => {
    const bytes = Buffer.from(
      JSON.stringify({ action: "synchronize", number: 7, repository: { full_name: "acme/store" } }),
    );
    const signature = `sha256=${createHmac("sha256", p.env.VISUALGUARD_GITHUB_WEBHOOK_SECRET).update(bytes).digest("hex")}`;
    await expect(github.webhook(bytes, "sha256=wrong", "pull_request")).rejects.toMatchObject({
      status: 401,
    });
    expect(await github.webhook(bytes, signature, "pull_request")).toEqual({ reconciled: 1 });
    await github.webhook(bytes, signature, "pull_request");
    expect(checks).toHaveLength(1);
    state = "closed";
    expect((await github.reconcile(owner, "storefront", 7)).closed).toBe(true);
  });
});
