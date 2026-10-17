import { z } from "zod";
import { randomUUID } from "node:crypto";
import { fingerprint } from "../../../packages/visualguard/src/core/provenance.js";
import type { BaselineEntry, BaselineVersion, BaselineHistory } from "../shared/baselines.js";
import type { ReviewThread } from "../shared/reviews.js";
import type { RunDetail } from "../shared/contracts.js";
import { AuthService, type Actor, type User, type Membership } from "./auth.js";
import type { PlatformRepository, StateStore } from "./storage-contracts.js";
import { touchAdministratorGuard } from "./administration.js";
import { touchProject, type ProjectGuard } from "./invitations.js";
import { prepareBaselineRun, pinBaselineRun } from "./baseline-guards.js";
import { PlatformError } from "./errors.js";
import { sha256 } from "./artifacts.js";

export const baselineSet = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const reason = z.string().trim().min(1).max(2000);
const revision = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i);
export const baselinePromotion = z
  .object({
    expectedVersion: z.number().int().min(0).max(999999999),
    runId: z.string().uuid(),
    evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: revision,
    targetRevision: revision,
    landed: z.literal(true),
    reason,
    coverageChangeReason: reason.optional(),
  })
  .strict();
export const baselineRestore = z
  .object({
    expectedVersion: z.number().int().positive().max(999999999),
    version: z.number().int().positive().max(999999999),
    reason,
  })
  .strict();
export const baselineKey = (project: string, set: string) => `${project}:${set}`;
const versionKey = (project: string, set: string, version: number) =>
  `${baselineKey(project, set)}:${String(version).padStart(10, "0")}`;
const conflict = () =>
  new PlatformError(409, "Baseline or review changed; refresh before trying again");
export const baselineSummary = ({ entries, ...version }: BaselineVersion) => ({
  ...version,
  checkCount: entries.length,
});

export class Baselines {
  constructor(
    private repository: PlatformRepository,
    private state: StateStore,
    private auth: AuthService,
  ) {}

  private async access(actor: Actor, project: string, write = false) {
    if (actor.credentialId) {
      if (write || actor.uploadProject !== project)
        throw new PlatformError(403, "This credential cannot access these baselines");
    } else await this.auth.requireRole(actor, project, write ? "maintainer" : "viewer");
    if (!(await this.repository.projects([project])).length)
      throw new PlatformError(404, "Project not found");
  }
  async list(actor: Actor, project: string) {
    await this.access(actor, project);
    return (
      await this.state.list<{ currentVersion: number }>("baseline-heads", `${project}:`, 100)
    ).map((row) => ({ set: row.id.slice(project.length + 1), ...row.value }));
  }
  async version(actor: Actor, project: string, set: string, version?: number) {
    baselineSet.parse(set);
    await this.access(actor, project);
    const head = await this.state.get<{ currentVersion: number }>(
      "baseline-heads",
      baselineKey(project, set),
    );
    const selected = version ?? head?.value.currentVersion;
    const row =
      selected &&
      (await this.state.get<BaselineVersion>(
        "baseline-versions",
        versionKey(project, set, selected),
      ));
    if (!row) throw new PlatformError(404, "Approved baseline version not found");
    return row.value;
  }
  async history(
    actor: Actor,
    project: string,
    set: string,
    after?: string,
  ): Promise<BaselineHistory> {
    baselineSet.parse(set);
    await this.access(actor, project);
    const prefix = `${baselineKey(project, set)}:`;
    if (after && (!after.startsWith(prefix) || !/^\d{10}$/.test(after.slice(prefix.length))))
      throw new PlatformError(400, "Invalid baseline history cursor");
    const rows = await this.state.list<BaselineVersion>("baseline-versions", prefix, 21, after);
    const head = await this.state.get<{ currentVersion: number }>(
      "baseline-heads",
      baselineKey(project, set),
    );
    return {
      currentVersion: head?.value.currentVersion ?? 0,
      items: rows.slice(0, 20).map((row) => baselineSummary(row.value)),
      nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      canPromote: !actor.credentialId && (await this.auth.hasRole(actor, project, "maintainer")),
    };
  }
  private async authority(
    store: StateStore,
    id: string,
    project: string,
    role: "reviewer" | "maintainer",
    actor?: Actor,
  ) {
    if (this.auth.mode === "local" && id === "local-owner") return;
    const user = await store.get<User>("users", id);
    if (!user || user.value.disabled) throw new PlatformError(403, "Account is no longer active");
    if (!(await store.replace("users", user))) throw conflict();
    if (user.value.role !== "admin") {
      const membership = await store.get<Membership>("memberships", `${id}:${project}`);
      if (
        !membership ||
        !(role === "reviewer" ? ["reviewer", "maintainer"] : ["maintainer"]).includes(
          membership.value.role,
        )
      )
        throw new PlatformError(403, "Required project role is no longer available");
      if (!(await store.replace("memberships", membership))) throw conflict();
    }
    if (actor) {
      const session =
        actor.sessionId &&
        (await store.get<{ userId: string; authVersion: number }>("sessions", actor.sessionId));
      if (
        !session ||
        session.value.userId !== id ||
        session.value.authVersion !== user.value.authVersion
      )
        throw new PlatformError(401, "Sign in again before promoting baselines");
      if (!(await store.replace("sessions", session))) throw conflict();
    }
  }
  private async transaction<T>(work: (store: StateStore) => Promise<T>) {
    if (!this.state.transaction || !(await this.state.supportsTransactions?.()))
      throw new PlatformError(
        503,
        "Approved baseline changes require SQLite, PostgreSQL, or a MongoDB replica set",
      );
    return this.state.transaction(async (store) => {
      await touchAdministratorGuard(store);
      return work(store);
    });
  }
  private entries(run: RunDetail): BaselineEntry[] {
    if (
      !run.complete ||
      run.manifest.incomplete ||
      !run.manifest.jobs.length ||
      run.manifest.jobs.length > 1000
    )
      throw new PlatformError(409, "Promotion requires complete evidence with 1–1000 checks");
    return run.manifest.jobs.map((job) => {
      const capture = job.captures.staging;
      if (!/^[a-zA-Z0-9_-]{1,220}$/.test(job.id))
        throw new PlatformError(409, `Check ID cannot be exported safely: ${job.id}`);
      const identity = job.renderingIdentity;
      if (
        !identity ||
        typeof identity !== "object" ||
        !("platform" in identity) ||
        !("policy" in identity)
      )
        throw new PlatformError(
          409,
          `Capture identity missing for ${job.id}; capture with the current engine`,
        );
      if (job.error || job.status === "error" || !job.diff || !capture || !job.captures.production)
        throw new PlatformError(409, `Compared evidence is required for ${job.id}`);
      if (
        Object.values(job.captures).some(
          (item) =>
            item &&
            (item.truncated ||
              item.unstable ||
              item.health.checkErrors?.length ||
              item.health.consoleErrors.length ||
              item.health.failedRequests.length ||
              item.health.brokenImages.length ||
              item.health.accessibility?.some((issue) =>
                ["serious", "critical"].includes(issue.impact),
              )),
        ) ||
        job.findings?.some((item) => item.severity === "regression" && item.source !== "baseline")
      )
        throw new PlatformError(409, `Independent failures or unreliable captures block ${job.id}`);
      const image = run.artifacts.find(
        (item) => item.path === capture.image && item.mediaType === "image/png",
      );
      const dom = capture.dom
        ? run.artifacts.find(
            (item) => item.path === capture.dom && item.mediaType === "application/json",
          )
        : undefined;
      if (!image || (capture.dom && !dom))
        throw new PlatformError(409, `Saved artifacts are missing for ${job.id}`);
      return {
        key: fingerprint({ jobId: job.id, route: job.route, viewport: job.viewport, identity }),
        jobId: job.id,
        name: job.name,
        route: job.route,
        viewport: job.viewport,
        renderingIdentity: identity,
        image,
        dom,
        health: capture.health,
        review: { eventId: "", actorId: "", scopeDigest: "" },
      };
    });
  }
  private async prepare(project: string, runId: string) {
    await this.state.create<ProjectGuard>("invitation-projects", project, { status: "active" });
    await prepareBaselineRun(this.state, runId);
  }
  private async save(
    store: StateStore,
    actor: Actor,
    project: string,
    set: string,
    expectedVersion: number,
    value: BaselineVersion,
  ) {
    await touchProject(store, project);
    await this.authority(store, actor.id, project, "maintainer", actor);
    await pinBaselineRun(store, value.runId);
    const id = baselineKey(project, set);
    const head = await store.get<{ currentVersion: number }>("baseline-heads", id);
    if ((head?.value.currentVersion ?? 0) !== expectedVersion) throw conflict();
    if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
      throw new PlatformError(
        413,
        "Baseline snapshot exceeds 2 MiB; split checks into separate sets",
      );
    if (!head && (await store.list("baseline-heads", `${project}:`, 100)).length >= 100)
      throw new PlatformError(413, "Project has reached its 100 baseline set limit");
    if (!(await store.create("baseline-versions", versionKey(project, set, value.version), value)))
      throw conflict();
    if (
      !(head
        ? await store.replace("baseline-heads", {
            ...head,
            value: { currentVersion: value.version },
          })
        : await store.create("baseline-heads", id, { currentVersion: value.version }))
    )
      throw conflict();
    const at = value.promotedAt;
    if (
      !(await store.create(
        "audit",
        `${String(9999999999999 - Date.parse(at)).padStart(13, "0")}-${randomUUID()}`,
        {
          at,
          actorId: actor.id,
          action: value.restoredFrom ? "baseline.restore" : "baseline.promote",
          details: { projectId: project, set, version: value.version, runId: value.runId },
        },
        new Date(Date.parse(at) + 90 * 86400000).toISOString(),
      ))
    )
      throw conflict();
    return value;
  }
  async promote(
    actor: Actor,
    project: string,
    set: string,
    input: z.infer<typeof baselinePromotion>,
  ) {
    baselineSet.parse(set);
    baselinePromotion.parse(input);
    await this.access(actor, project, true);
    await this.prepare(project, input.runId);
    const run = await this.repository.getRun(input.runId);
    if (run.projectId !== project)
      throw new PlatformError(403, "Candidate belongs to another project");
    if (run.digest !== input.evidenceDigest || run.metadata.commit !== input.sourceRevision)
      throw new PlatformError(409, "Candidate revision or evidence changed");
    const entries = this.entries(run);
    return this.transaction(async (store) => {
      const current = input.expectedVersion
        ? await store.get<BaselineVersion>(
            "baseline-versions",
            versionKey(project, set, input.expectedVersion),
          )
        : undefined;
      if (input.expectedVersion && !current) throw conflict();
      if (current) {
        const old = new Set(current.value.entries.map((item) => item.key));
        const next = new Set(entries.map((item) => item.key));
        if (
          ([...old].some((key) => !next.has(key)) || [...next].some((key) => !old.has(key))) &&
          !input.coverageChangeReason
        )
          throw new PlatformError(
            409,
            "Coverage changed; provide an explicit reason for added or removed rendering identities",
          );
        for (const entry of entries) {
          const previous = current.value.entries.find((item) => item.key === entry.key);
          const job = run.manifest.jobs.find((item) => item.id === entry.jobId)!;
          const reference = run.artifacts.find(
            (item) => item.path === job.captures.production!.image,
          );
          if (previous && reference?.hash !== previous.image.hash)
            throw new PlatformError(
              409,
              `${entry.jobId} compared against a stale reference; pull the current approved version and rerun`,
            );
        }
      }
      for (const entry of entries) {
        const job = run.manifest.jobs.find((item) => item.id === entry.jobId)!;
        const scopeDigest = sha256(
          JSON.stringify({ runId: run.id, digest: run.digest, revision: run.metadata.commit, job }),
        );
        const row = await store.get<ReviewThread>(
          "reviews",
          `${project}:${run.id}:${sha256(job.id)}`,
        );
        const decision =
          row &&
          [...row.value.events]
            .reverse()
            .find((event) =>
              ["approve_visual_change", "reject_visual_change", "withdraw_decision"].includes(
                event.action,
              ),
            );
        if (
          !row ||
          row.value.evidenceDigest !== run.digest ||
          row.value.scopeDigest !== scopeDigest ||
          decision?.action !== "approve_visual_change"
        )
          throw new PlatformError(409, `Current visual approval is required for ${job.id}`);
        await this.authority(store, decision.actor.id, project, "reviewer");
        if (!(await store.replace("reviews", row))) throw conflict();
        entry.review = { eventId: decision.id, actorId: decision.actor.id, scopeDigest };
      }
      return this.save(store, actor, project, set, input.expectedVersion, {
        projectId: project,
        set,
        version: input.expectedVersion + 1,
        parentVersion: input.expectedVersion,
        runId: run.id,
        evidenceDigest: run.digest,
        sourceRevision: input.sourceRevision,
        targetRevision: input.targetRevision,
        promotedAt: new Date().toISOString(),
        actor: { id: actor.id, name: actor.name },
        reason: input.reason,
        coverageChangeReason: input.coverageChangeReason,
        policyVersion: 1,
        entries,
      });
    });
  }
  async restore(
    actor: Actor,
    project: string,
    set: string,
    input: z.infer<typeof baselineRestore>,
  ) {
    baselineRestore.parse(input);
    await this.access(actor, project, true);
    const previous = await this.version(actor, project, set, input.version);
    await this.prepare(project, previous.runId);
    await this.repository.getRun(previous.runId);
    return this.transaction((store) =>
      this.save(store, actor, project, set, input.expectedVersion, {
        ...previous,
        version: input.expectedVersion + 1,
        parentVersion: input.expectedVersion,
        restoredFrom: previous.version,
        promotedAt: new Date().toISOString(),
        actor: { id: actor.id, name: actor.name },
        reason: input.reason,
      }),
    );
  }
}
