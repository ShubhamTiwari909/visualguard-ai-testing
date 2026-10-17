import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPlatform } from "../../server/config.js";
import { AuthService, type Actor } from "../../server/auth.js";
import { Reviews } from "../../server/reviews.js";
import { Baselines } from "../../server/baselines.js";
import { Policies, type PolicyMutation } from "../../server/policies.js";
import { baselineRun } from "./baseline-run.js";
import type { RunDetail } from "../../shared/contracts.js";

export const owner: Actor = { id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: "" };
export const revision = "c".repeat(40);
export async function policyPlatform() {
  const root = await mkdtemp(join(tmpdir(), "vg-policy-"));
  const platform = await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: root });
  const env = {
    VISUALGUARD_AUTH_MODE: "local",
    VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
    VISUALGUARD_ADMIN_PASSWORD: "policy-test-only-password",
    VISUALGUARD_GITHUB_REPOSITORIES: "storefront=acme/store,other=acme/store",
    VISUALGUARD_GITHUB_TOKEN: "test-only-secret",
    VISUALGUARD_GITHUB_WEBHOOK_SECRET: "test-only-webhook",
  };
  const auth = new AuthService(platform.state, env);
  await auth.ready;
  const reviews = new Reviews(platform.repository, platform.state, auth);
  const baselines = new Baselines(platform.repository, platform.state, auth);
  const policies = new Policies(platform.repository, platform.state, auth);
  await platform.repository.createProject("storefront", "Storefront");
  const approve = async (run: RunDetail, action: "approve_visual_change" | "reject_visual_change" | "withdraw_decision" = "approve_visual_change", actor = owner) => {
    for (const job of run.manifest.jobs) {
      const view = await reviews.read(actor, run.id, job.id);
      await reviews.append(actor, run.id, { jobId: job.id, evidenceDigest: run.digest, scopeDigest: view.scopeDigest, expectedVersion: view.version,
        event: { action, reason: "Reviewed screenshot evidence" } });
    }
  };
  let source = baselineRun(randomUUID());
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=", "base64");
  for (const artifact of source.artifacts) {
    const bytes = artifact.path === "candidate.png" ? png : Buffer.concat([png, Buffer.from("old")]);
    artifact.hash = await platform.store.put(bytes); artifact.size = bytes.length;
  }
  source = (await platform.repository.insertRun(source)).run;
  await approve(source);
  const baseline = await baselines.promote(owner, "storefront", "main", {
    expectedVersion: 0, runId: source.id, evidenceDigest: source.digest, sourceRevision: source.metadata.commit!,
    targetRevision: "b".repeat(40), landed: true, reason: "Approved source landed",
  });
  const candidate = () => {
    const run = baselineRun(randomUUID());
    run.digest = randomUUID().replaceAll("-", "").repeat(2);
    run.engineRunId = randomUUID(); run.manifest.id = run.engineRunId;
    run.startedAt = new Date().toISOString(); run.manifest.startedAt = run.startedAt;
    run.metadata = { ...run.metadata, commit: revision, pullRequest: 7 };
    run.manifest.provenance = { sourceRevision: revision, expectedJobs: run.manifest.jobs.map((job) => job.id), group: "fixture", fingerprint: "fixture" };
    run.artifacts = structuredClone(source.artifacts);
    run.artifacts.find((item) => item.path === "reference.png")!.hash = baseline.entries[0]!.image.hash;
    run.artifacts.find((item) => item.path === "reference.png")!.size = baseline.entries[0]!.image.size;
    for (const job of run.manifest.jobs) {
      const entry = baseline.entries.find((item) => item.jobId === job.id)!;
      job.captures.production!.source = "baseline";
      job.captures.production!.approvedReference = {
        projectId: "storefront", set: "main", version: 1, checkKey: entry.key, runId: source.id,
        evidenceDigest: source.digest, sourceRevision: source.metadata.commit!, targetRevision: baseline.targetRevision,
        promotedAt: baseline.promotedAt, policyVersion: 1,
      };
    }
    return run;
  };
  const mutation: PolicyMutation = { expectedVersion: 0, reason: "Pilot visual policy", policy: {
    mode: "informative", baselineSet: "main", targetBranch: "main", environment: "staging", requiredChecks: [],
    requireApproval: true, maxAgeHours: 24, repository: "acme/store", exceptions: [],
  } };
  const save = async (input = mutation) => policies.save(owner, "storefront", input);
  const insert = async (run: RunDetail) => (await platform.repository.insertRun(run, run.id)).run;
  return { ...platform, root, env, auth, reviews, baselines, policies, source, baseline, candidate, approve, mutation, save, insert,
    async dispose() { await platform.close(); await rm(root, { recursive: true, force: true }); },
  };
}
