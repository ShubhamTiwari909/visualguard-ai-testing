import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PolicyAssessment, PolicyDelivery, PolicyVersion } from "../shared/policies.js";
import { Policies, pullRequestNumber, sourceRevision } from "./policies.js";
import type { Actor } from "./auth.js";
import { PlatformError } from "./errors.js";

const prSchema = z.object({ state: z.string(), head: z.object({ sha: sourceRevision }), base: z.object({ ref: z.string() }) });
const checkSchema = z.object({ id: z.number().int().positive(), html_url: z.string().url() });
export class PolicyGitHub {
  constructor(private policies: Policies, private request: typeof fetch = fetch) {}
  private async api(repository: string, path: string, method = "GET", data?: unknown): Promise<unknown> {
    const token = this.policies.auth.env.VISUALGUARD_GITHUB_TOKEN;
    if (!token || !this.policies.allowedRepository(repository))
      throw new PlatformError(503, "Configure the GitHub credential and repository allowlist on the dashboard server");
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.request(`https://api.github.com/repos/${repository}${path}`, {
          method, redirect: "error", signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
          body: data === undefined ? undefined : JSON.stringify(data),
        });
      } catch {
        // A POST may have reached GitHub. Reconciliation finds its external ID before creating again.
        if (method === "POST" || attempt === 2) throw new PlatformError(502, "GitHub delivery was interrupted; reconcile again to recover");
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt)); continue;
      }
      if (!response.ok) {
        if (method !== "POST" && attempt < 2 && (response.status === 429 || response.status >= 500)) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt)); continue;
        }
        await response.body?.cancel();
        throw new PlatformError(502, `GitHub request failed (${response.status}); check permissions or retry reconciliation`);
      }
      return response.json();
    }
    throw new PlatformError(502, "GitHub is unavailable");
  }
  async deliveries(actor: Actor, project: string) {
    await this.policies.access(actor, project);
    return (await this.policies.state.list<PolicyDelivery>("policy-deliveries", `${project}:`, 100)).map((row) => row.value);
  }
  async reconcile(actor: Actor, project: string, pullRequest: number): Promise<PolicyDelivery> {
    pullRequestNumber.parse(pullRequest);
    await this.policies.access(actor, project, !actor.credentialId);
    const policy = (await this.policies.history(actor, project)).current;
    if (!policy?.repository) throw new PlatformError(409, "Configure a GitHub repository in the project policy first");
    const repository = policy.repository;
    if (!this.policies.allowedRepository(repository, project)) throw new PlatformError(403, "This repository is not allowed for this project");
    const lockId = project;
    const owner = randomUUID();
    if (!(await this.policies.state.create("policy-locks", lockId, { owner }, new Date(Date.now() + 600000).toISOString())))
      throw new PlatformError(409, "GitHub reconciliation is already running; retry later");
    const locked = await this.policies.state.get<{ owner: string }>("policy-locks", lockId);
    const assertLease = async () => {
      if ((await this.policies.state.get<{ owner: string }>("policy-locks", lockId))?.value.owner !== owner)
        throw new PlatformError(409, "Reconciliation lease expired; retry");
    };
    const id = `${project}:${String(pullRequest).padStart(10, "0")}`;
    const previous = await this.policies.state.get<PolicyDelivery>("policy-deliveries", id);
    const delivery: PolicyDelivery = { ...(previous?.value.repository === repository ? previous.value : {}), projectId: project, repository, pullRequest, revision: previous?.value.revision ?? "", error: undefined, updatedAt: new Date().toISOString() };
    const save = async () => {
      await assertLease();
      const row = await this.policies.state.get<PolicyDelivery>("policy-deliveries", id);
      if (!row) {
        const tracked = await this.policies.state.list<PolicyDelivery>("policy-deliveries", `${project}:`, 100);
        if (tracked.length >= 100) {
          const closed = tracked.find((item) => item.value.closed);
          if (!closed) throw new PlatformError(413, "At most 100 open PRs can be tracked per project");
          await this.policies.state.remove("policy-deliveries", closed.id, closed.version);
        }
      }
      if (!(row ? await this.policies.state.replace("policy-deliveries", { ...row, value: delivery }) : await this.policies.state.create("policy-deliveries", id, delivery)))
        throw new PlatformError(409, "Reconciliation state changed; retry");
    };
    try {
      // Persist intent first: a process failure or ambiguous API response can be retried later.
      await save();
      const pr = prSchema.parse(await this.api(repository, `/pulls/${pullRequest}`));
      if (delivery.revision !== pr.head.sha) { delivery.checkId = undefined; delivery.checkUrl = undefined; delivery.assessment = undefined; }
      delivery.revision = pr.head.sha;
      delivery.closed = pr.state !== "open";
      if (delivery.closed) { await save(); return delivery; }
      if (pr.base.ref !== policy.targetBranch)
        throw new PlatformError(409, "PR must be open and target the policy's configured branch");
      const externalId = `visualguard:${project}:${pr.head.sha}`;
      const name = `VisualGuard / ${project}`;
      let check: z.infer<typeof checkSchema> | undefined;
      // Recover a check created before a response/process failure, without making a duplicate.
      for (let page = 1; page <= 10; page++) {
        const result = z.object({ check_runs: z.array(checkSchema.extend({ external_id: z.string().nullable(), name: z.string() })) }).parse(
          await this.api(repository, `/commits/${pr.head.sha}/check-runs?per_page=100&filter=all&page=${page}`));
        check = result.check_runs.find((item) => item.external_id === externalId && item.name === name);
        if (check || result.check_runs.length < 100) break;
        if (page === 10) throw new PlatformError(413, "Too many commit checks to reconcile safely");
      }
      await assertLease();
      const pending = { name, status: "in_progress", output: { title: "Assessing current visual evidence", summary: "Waiting for a fresh exact-revision policy assessment." } };
      check = checkSchema.parse(check ? await this.api(repository, `/check-runs/${check.id}`, "PATCH", pending)
        : await this.api(repository, "/check-runs", "POST", { ...pending, head_sha: pr.head.sha, external_id: externalId }));
      delivery.checkId = check.id;
      delivery.checkUrl = check.html_url;
      await save();
      const assessment = await this.policies.assess(actor, project, pr.head.sha, undefined, pullRequest);
      delivery.assessment = assessment;
      const head = prSchema.parse(await this.api(repository, `/pulls/${pullRequest}`));
      const freshPolicy = (await this.policies.history(actor, project)).current;
      if (head.state !== "open" || head.head.sha !== pr.head.sha || head.base.ref !== policy.targetBranch || freshPolicy?.version !== policy.version)
        throw new PlatformError(409, "PR head or policy changed during assessment; reconcile again");
      await assertLease();
      const conclusion = assessment.mode === "informative" ? "neutral" : assessment.status === "satisfied" ? "success" : assessment.status === "blocked" ? "failure" : undefined;
      await this.api(repository, `/check-runs/${check.id}`, "PATCH", {
        name, status: conclusion ? "completed" : "in_progress", ...(conclusion ? { conclusion } : {}),
        ...(this.policies.auth.publicUrl ? { details_url: `${this.policies.auth.publicUrl.origin}/policies?project=${encodeURIComponent(project)}` } : {}),
        output: { title: `${assessment.mode === "informative" ? "Informative: " : ""}${assessment.status}`,
          summary: this.summary(assessment),
        },
      });
      // Re-evaluate decisions, baseline, expiry and evidence after network delivery. If they moved,
      // invalidate this check immediately; scheduled reconciliation repairs interrupted invalidation.
      const latest = await this.policies.assess(actor, project, pr.head.sha, undefined, pullRequest);
      if (latest.fingerprint !== assessment.fingerprint) {
        await assertLease();
        await this.api(repository, `/check-runs/${check.id}`, "PATCH", pending);
        throw new PlatformError(409, "Visual evidence, baseline or decisions changed; reconcile again");
      }
      delivery.updatedAt = new Date().toISOString();
      await save();
      return delivery;
    } catch (error) {
      delivery.error = error instanceof PlatformError ? error.message : "Unable to reconcile GitHub; retry after checking the server configuration";
      delivery.updatedAt = new Date().toISOString();
      await save().catch(() => {});
      // Never leave a known stale success after a failed re-evaluation.
      if (delivery.checkId) {
        // A newer lease owner may already have published a fresh result. An expired
        // worker must not overwrite that result while handling its own failure.
        await assertLease().then(() => this.api(repository, `/check-runs/${delivery.checkId}`, "PATCH", {
          status: "in_progress", output: { title: "Reconciliation required", summary: delivery.error },
        })).catch(() => {});
      }
      throw new PlatformError(error instanceof PlatformError ? error.status : 502, delivery.error);
    } finally {
      const current = await this.policies.state.get<{ owner: string }>("policy-locks", lockId);
      if (locked && current?.value.owner === owner) await this.policies.state.remove("policy-locks", lockId, current.version);
    }
  }
  private summary(assessment: PolicyAssessment) {
    return [
      `Revision: ${assessment.revision}`, `Policy: v${assessment.policyVersion}; baseline: v${assessment.baselineVersion ?? "missing"}`,
      `Evidence: ${assessment.evidenceDigest ?? "missing"}`, ...assessment.reasons,
      ...(assessment.waivedChecks.length ? [`Expiring visual approval exceptions: ${assessment.waivedChecks.join(", ")}`] : []),
      "This check is a point-in-time assessment. Reconcile after decisions, policy, baseline or access changes.",
    ].join("\n").slice(0, 60000);
  }
  verifyWebhook(bytes: Buffer, signature: string | undefined) {
    const secret = this.policies.auth.env.VISUALGUARD_GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new PlatformError(503, "GitHub webhook secret is not configured");
    const expected = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
    if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw new PlatformError(401, "Invalid GitHub webhook signature");
  }
  async webhook(bytes: Buffer, signature: string | undefined, event: string | undefined) {
    this.verifyWebhook(bytes, signature);
    if (event !== "pull_request") return { ignored: true };
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new PlatformError(400, "Invalid webhook JSON"); }
    const payload = z.object({ action: z.string(), number: pullRequestNumber, repository: z.object({ full_name: z.string() }) }).parse(value);
    if (!["opened", "reopened", "synchronize", "ready_for_review", "edited", "closed"].includes(payload.action)) return { ignored: true };
    if (!this.policies.allowedRepository(payload.repository.full_name)) throw new PlatformError(403, "Repository is not allowed");
    let after: string | undefined;
    let matched = 0;
    for (;;) {
      const rows = await this.policies.state.list<PolicyVersion[]>("visual-policies", "", 100, after);
      for (const row of rows) {
        if (row.value.at(-1)?.repository?.toLowerCase() !== payload.repository.full_name.toLowerCase()) continue;
        const actor: Actor = { id: "github-reconciler", name: "GitHub reconciler", email: "", admin: true, csrf: "" };
        await this.reconcile(actor, row.id, payload.number);
        matched++;
      }
      if (rows.length < 100) break;
      after = rows.at(-1)!.id;
    }
    return { reconciled: matched };
  }
}
