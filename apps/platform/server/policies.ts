import { z } from "zod";
import { fingerprint } from "../../../packages/visualguard/src/core/provenance.js";
import type { JobResult } from "../../../packages/visualguard/src/core/types.js";
import type { PolicyAssessment, PolicyHistory, PolicyVersion } from "../shared/policies.js";
import { AuthService, type Actor } from "./auth.js";
import { Baselines, baselineSet } from "./baselines.js";
import { Reviews } from "./reviews.js";
import { canonical, completeness } from "./ingest.js";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { PlatformRepository, StateStore } from "./storage-contracts.js";

export const sourceRevision = z.string().regex(/^[a-f0-9]{40}$/);
export const pullRequestNumber = z.number().int().min(1).max(2147483647);
export const policyMutation = z.object({
  expectedVersion: z.number().int().min(0).max(199),
  reason: z.string().trim().min(1).max(2000),
  policy: z.object({
    mode: z.enum(["informative", "required"]),
    baselineSet,
    targetBranch: z.string().trim().min(1).max(200),
    environment: z.string().trim().min(1).max(100),
    requiredChecks: z.array(z.string().min(1).max(220)).max(1000),
    requireApproval: z.boolean(),
    maxAgeHours: z.number().int().min(1).max(720),
    repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/).optional(),
    exceptions: z.array(z.object({
      revision: sourceRevision,
      jobId: z.string().min(1).max(220),
      reason: z.string().trim().min(1).max(1000),
      expiresAt: z.string().datetime(),
    }).strict()).max(50),
  }).strict(),
}).strict();
export type PolicyMutation = z.infer<typeof policyMutation>;
export const assessmentInput = z.object({ revision: sourceRevision, runId: z.string().uuid().optional() }).strict();

export class Policies {
  constructor(
    readonly repository: PlatformRepository,
    readonly state: StateStore,
    readonly auth: AuthService,
  ) {}
  async access(actor: Actor, project: string, write = false) {
    if (actor.credentialId) {
      if (write || actor.uploadProject !== project)
        throw new PlatformError(403, "This credential cannot access this policy");
    } else await this.auth.requireRole(actor, project, write ? "maintainer" : "viewer");
    if (!(await this.repository.projects([project])).length)
      throw new PlatformError(404, "Project not found");
  }
  allowedRepository(repository: string, project?: string) {
    return (this.auth.env.VISUALGUARD_GITHUB_REPOSITORIES ?? "").split(",").some((item) => {
      const [id, repo] = item.trim().split("=");
      return (!project || id === project) && repo?.toLowerCase() === repository.toLowerCase();
    });
  }
  async history(actor: Actor, project: string): Promise<PolicyHistory> {
    await this.access(actor, project);
    const row = await this.state.get<PolicyVersion[]>("visual-policies", project);
    const versions = row?.value ?? [];
    const current = versions[versions.length - 1];
    return {
      current, versions: [...versions].reverse(),
      canEdit: !actor.credentialId && await this.auth.hasRole(actor, project, "maintainer"),
      githubConfigured: Boolean(current?.repository && this.allowedRepository(current.repository, project) && this.auth.env.VISUALGUARD_GITHUB_TOKEN),
    };
  }
  async save(actor: Actor, project: string, input: PolicyMutation) {
    policyMutation.parse(input);
    await this.access(actor, project, true);
    const row = await this.state.get<PolicyVersion[]>("visual-policies", project);
    const versions = row?.value ?? [];
    if (versions.length !== input.expectedVersion)
      throw new PlatformError(409, "Policy changed; refresh before saving");
    if (versions.length >= 200) throw new PlatformError(413, "Policy history has reached 200 versions");
    if (new Set(input.policy.requiredChecks).size !== input.policy.requiredChecks.length)
      throw new PlatformError(400, "Required check IDs must be unique");
    if (input.policy.repository && !this.allowedRepository(input.policy.repository, project))
      throw new PlatformError(400, "Repository must be allowed by VISUALGUARD_GITHUB_REPOSITORIES");
    for (const exception of input.policy.exceptions) {
      const expires = Date.parse(exception.expiresAt);
      if (expires <= Date.now() || expires > Date.now() + 7 * 86400000)
        throw new PlatformError(400, "Exceptions must expire within the next seven days");
    }
    const next: PolicyVersion = {
      ...input.policy, projectId: project, version: versions.length + 1,
      at: new Date().toISOString(), actor: { id: actor.id, name: actor.name }, reason: input.reason,
    };
    if (Buffer.byteLength(JSON.stringify([...versions, next])) > 2 * 1024 * 1024)
      throw new PlatformError(413, "Policy history exceeds 2 MiB");
    if (!(row ? await this.state.replace("visual-policies", { ...row, value: [...versions, next] })
      : await this.state.create("visual-policies", project, [next])))
      throw new PlatformError(409, "Policy changed; refresh before saving");
    await this.auth.audit(actor, "policy.save", { projectId: project, version: next.version }).catch(() => {});
    return this.history(actor, project);
  }
  async assess(actor: Actor, project: string, revision: string, runId?: string, pullRequest?: number): Promise<PolicyAssessment> {
    sourceRevision.parse(revision);
    if (pullRequest !== undefined) pullRequestNumber.parse(pullRequest);
    await this.access(actor, project);
    const policy = (await this.history(actor, project)).current;
    const result: PolicyAssessment = {
      projectId: project, revision, policyVersion: policy?.version ?? 0,
      mode: policy?.mode ?? "informative", status: "pending", reasons: [], waivedChecks: [],
      assessedAt: new Date().toISOString(), fingerprint: "",
    };
    const observations: unknown[] = [];
    const finish = () => {
      const { assessedAt: _time, fingerprint: _fingerprint, ...stable } = result;
      result.fingerprint = sha256(canonical({ ...stable, observations }));
      return result;
    };
    if (!policy) { result.reasons.push("Configure a visual regression policy first."); return finish(); }
    if (!runId) {
      const page = await this.repository.runs({ project, commit: revision, environment: policy.environment, pullRequest, limit: 1 });
      runId = page.runs[0]?.id;
    }
    if (!runId) { result.reasons.push(pullRequest === undefined ? "No uploaded evidence for this exact revision and environment." : "No uploaded evidence bound to this exact PR, commit and environment."); return finish(); }
    const run = await this.repository.getRun(runId);
    if (run.projectId !== project) throw new PlatformError(403, "Evidence belongs to another project");
    result.runId = run.id;
    result.evidenceDigest = run.digest;
    const block = (reason: string) => result.reasons.push(reason);
    if (run.metadata.commit !== revision || run.manifest.provenance?.sourceRevision !== revision)
      block("Run metadata and capture provenance must both match the candidate revision.");
    if (pullRequest !== undefined && run.metadata.pullRequest !== pullRequest) block("Evidence belongs to a different pull request.");
    if (run.metadata.environment !== policy.environment) block("Evidence uses a different environment.");
    if (run.mode !== "compare" && run.mode !== "baseline") block("A screenshot comparison run is required.");
    if (!run.complete || completeness(run.manifest).length) block("Evidence is incomplete; upload all checks and merge all shards.");
    const age = Date.now() - Date.parse(run.startedAt);
    if (!Number.isFinite(age) || age < -300000 || age > policy.maxAgeHours * 3600000)
      block("Evidence has expired or has an invalid capture time.");
    const baselines = new Baselines(this.repository, this.state, this.auth);
    let baseline;
    try { baseline = await baselines.version(actor, project, policy.baselineSet); }
    catch (error) {
      if (!(error instanceof PlatformError) || error.status !== 404) throw error;
      block("Initialize the approved baseline set before assessing visual changes.");
    }
    result.baselineVersion = baseline?.version;
    const ids = new Set(run.manifest.jobs.map((job) => job.id));
    if (ids.size !== run.manifest.jobs.length) block("Duplicate screenshot check IDs are ambiguous.");
    const required = policy.requiredChecks.length ? policy.requiredChecks : baseline?.entries.map((entry) => entry.jobId) ?? [];
    for (const id of required) if (!ids.has(id)) block(`Missing required screenshot: ${id}.`);
    if (run.manifest.jobs.length > 1000) block("Split runs with more than 1000 screenshot checks.");
    const reviews = new Reviews(this.repository, this.state, this.auth);
    for (const job of run.manifest.jobs.slice(0, 1000)) {
      const prefix = `${job.id}: `;
      const capture = job.captures.production;
      if (job.error || job.status === "error" || !job.diff || !capture || !job.captures.staging) {
        block(prefix + "a successful screenshot comparison is required."); continue;
      }
      if (!Number.isFinite(job.diff.diffPixels) || job.diff.diffPixels < 0 || !Number.isFinite(job.diff.diffRatio) || job.diff.diffRatio < 0)
        block(prefix + "invalid screenshot comparison metrics.");
      if (this.independentFailure(job)) block(prefix + "capture reliability or independent checks failed; visual approval cannot waive this.");
      for (const item of Object.values(job.captures)) {
        if (item && (!run.artifacts.some((artifact) => artifact.path === item.image && artifact.mediaType === "image/png") ||
          (item.dom && !run.artifacts.some((artifact) => artifact.path === item.dom))))
          block(prefix + "saved capture artifacts are missing.");
      }
      const entry = baseline?.entries.find((item) => item.jobId === job.id);
      const ref = capture.approvedReference;
      const image = run.artifacts.find((item) => item.path === capture.image);
      const dom = run.artifacts.find((item) => item.path === capture.dom);
      if (!entry || !job.renderingIdentity || entry.key !== fingerprint({ jobId: job.id, route: job.route, viewport: job.viewport, identity: job.renderingIdentity }) ||
        !ref || ref.projectId !== project || ref.set !== policy.baselineSet || ref.version !== baseline?.version ||
        ref.checkKey !== entry.key || ref.runId !== baseline?.runId || ref.evidenceDigest !== baseline?.evidenceDigest ||
        ref.sourceRevision !== baseline?.sourceRevision || ref.targetRevision !== baseline?.targetRevision ||
        ref.promotedAt !== baseline?.promotedAt || ref.policyVersion !== baseline?.policyVersion ||
        image?.hash !== entry.image.hash || dom?.hash !== entry.dom?.hash)
        block(prefix + "rerun with the current compatible approved baseline.");
      const view = await reviews.read(actor.credentialId ? { ...actor, credentialId: undefined, admin: true } : actor, run.id, job.id);
      observations.push({ jobId: job.id, reviewVersion: view.version, status: view.status, decision: view.decision?.id });
      if (view.status === "rejected") { block(prefix + "visual change was rejected."); continue; }
      if (policy.requireApproval && (job.diff.diffPixels > 0 || job.diff.diffRatio > 0 || ["review", "regression", "accepted"].includes(job.status)) && view.status !== "approved") {
        const exception = policy.exceptions.find((item) => item.revision === revision && item.jobId === job.id && Date.parse(item.expiresAt) > Date.now());
        if (exception) result.waivedChecks.push(job.id);
        else block(prefix + "an active reviewer must approve this exact visual evidence.");
      }
    }
    result.status = result.reasons.length ? "blocked" : "satisfied";
    if (!result.reasons.length) result.reasons.push("All required screenshots, references and visual decisions satisfy the current policy.");
    return finish();
  }
  private independentFailure(job: JobResult) {
    return Object.values(job.captures).some((capture) => capture && (
      capture.unstable || capture.truncated || !capture.health ||
      capture.health.checkErrors?.length || capture.health.consoleErrors.length ||
      capture.health.failedRequests.length || capture.health.brokenImages.length ||
      capture.health.accessibility?.some((issue) => ["serious", "critical"].includes(issue.impact))
    )) || job.findings?.some((finding) => finding.severity === "regression" && finding.source !== "baseline");
  }
}
