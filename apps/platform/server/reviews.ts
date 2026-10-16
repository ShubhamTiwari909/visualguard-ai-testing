import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { JobResult } from "../../../packages/visualguard/src/core/types.js";
import type { RunDetail } from "../shared/contracts.js";
import type {
  ReviewEvent,
  ReviewInboxItem,
  ReviewInboxPage,
  ReviewPerson,
  ReviewThread,
  ReviewView,
} from "../shared/reviews.js";
import type { PlatformRepository, StateRecord, StateStore } from "./storage-contracts.js";
import { AuthService, type Actor, type Membership, type User } from "./auth.js";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";

const person = (actor: Pick<Actor, "id" | "name">): ReviewPerson => ({
  id: actor.id,
  name: actor.name,
});
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(1).max(4000);
const action = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("comment"), reason, replyTo: z.string().uuid().optional() })
    .strict(),
  z
    .object({
      action: z.literal("assign"),
      reason,
      assigneeId: z.string().min(1).max(200).nullable(),
      dueAt: z.string().datetime().nullable(),
    })
    .strict(),
  z.object({ action: z.literal("approve_visual_change"), reason }).strict(),
  z.object({ action: z.literal("reject_visual_change"), reason }).strict(),
  z.object({ action: z.literal("withdraw_decision"), reason }).strict(),
]);
export const reviewMutation = z
  .object({
    jobId: z.string().min(1).max(500),
    evidenceDigest: hex,
    scopeDigest: hex,
    expectedVersion: z.number().int().nonnegative(),
    event: action,
  })
  .strict();
export type ReviewMutation = z.infer<typeof reviewMutation>;

/** One CAS record per immutable run/check makes the event history append-only through this API. */
export class Reviews {
  constructor(
    private repository: PlatformRepository,
    private state: StateStore,
    private auth: AuthService,
  ) {}

  private key(run: RunDetail, jobId: string) {
    return `${run.projectId}:${run.id}:${sha256(jobId)}`;
  }

  private async evidence(actor: Actor, runId: string, jobId: string, write = false) {
    const run = await this.repository.getRun(runId);
    await this.auth.requireRole(actor, run.projectId, write ? "reviewer" : "viewer");
    return { run, ...this.checkEvidence(run, jobId) };
  }

  private checkEvidence(run: RunDetail, jobId: string) {
    const jobs = run.manifest.jobs.filter((item) => item.id === jobId);
    if (!jobs.length) throw new PlatformError(404, "Check not found in this run");
    if (jobs.length !== 1) throw new PlatformError(409, "Check identity is ambiguous in this run");
    const job = jobs[0]!;
    const scopeDigest = sha256(
      JSON.stringify({ runId: run.id, digest: run.digest, revision: run.metadata.commit, job }),
    );
    return { job, scopeDigest };
  }

  private async eligible(projectId: string, id: string): Promise<ReviewPerson | undefined> {
    if (id === "local-owner" && this.auth.mode === "local") return { id, name: "Local workspace" };
    const entry = await this.state.get<User>("users", id);
    if (!entry || entry.value.disabled) return undefined;
    const user = entry.value;
    if (
      !(await this.auth.hasRole(
        { id: user.id, name: user.name, email: user.email, admin: user.role === "admin", csrf: "" },
        projectId,
        "reviewer",
      ))
    )
      return undefined;
    return { id: user.id, name: user.name };
  }

  async reviewers(actor: Actor, projectId: string) {
    await this.auth.requireRole(actor, projectId);
    if (!(await this.repository.projects([projectId])).length)
      throw new PlatformError(404, "Project not found");
    if (this.auth.mode === "local") return [{ id: "local-owner", name: "Local workspace" }];
    // Membership keys start with user IDs, so page them once instead of re-reading
    // each account and membership separately for every user in the picker.
    const eligibleIds = new Set<string>();
    let membershipAfter = "";
    for (;;) {
      const memberships = await this.state.list<Membership>(
        "memberships",
        "",
        100,
        membershipAfter,
      );
      for (const { value } of memberships) {
        if (
          value.projectId === projectId &&
          (value.role === "reviewer" || value.role === "maintainer")
        )
          eligibleIds.add(value.userId);
      }
      if (memberships.length < 100) break;
      membershipAfter = memberships[memberships.length - 1]!.id;
    }
    // Expose only active eligible reviewers' IDs/names; assignment writes still
    // revalidate current account and project access through eligible().
    const people: ReviewPerson[] = [];
    let after = "";
    for (;;) {
      const users = await this.state.list<User>("users", "", 100, after);
      for (const { value: user } of users) {
        if (!user.disabled && (user.role === "admin" || eligibleIds.has(user.id)))
          people.push(person(user));
      }
      if (people.length > 1000) throw new PlatformError(413, "Too many project reviewers to list");
      if (users.length < 100) return people;
      after = users[users.length - 1]!.id;
    }
  }

  private empty(run: RunDetail, job: JobResult, scopeDigest: string): ReviewThread {
    return {
      projectId: run.projectId,
      runId: run.id,
      jobId: job.id,
      evidenceDigest: run.digest,
      scopeDigest,
      sourceRevision: run.metadata.commit,
      events: [],
    };
  }

  private async view(
    actor: Actor,
    run: RunDetail,
    job: JobResult,
    thread: ReviewThread,
    version: number,
  ): Promise<ReviewView> {
    const decision = [...thread.events]
      .reverse()
      .find((item) =>
        ["approve_visual_change", "reject_visual_change", "withdraw_decision"].includes(
          item.action,
        ),
      );
    const assignment = [...thread.events].reverse().find((item) => item.action === "assign");
    const invalidDecisionReason =
      decision &&
      decision.action !== "withdraw_decision" &&
      !(await this.eligible(run.projectId, decision.actor.id))
        ? "The decision's author no longer has reviewer access."
        : undefined;
    const status =
      !decision || decision.action === "withdraw_decision" || invalidDecisionReason
        ? "pending"
        : decision.action === "approve_visual_change"
          ? "approved"
          : "rejected";
    const assigneeAvailable = assignment?.assignee
      ? Boolean(await this.eligible(run.projectId, assignment.assignee.id))
      : false;
    return {
      ...thread,
      version,
      canReview: await this.auth.hasRole(actor, run.projectId, "reviewer"),
      status,
      decision,
      invalidDecisionReason,
      assignee: assignment?.assignee,
      assigneeAvailable,
      dueAt: assignment?.dueAt,
      overdue: Boolean(
        assignment?.dueAt && assignment.dueAt < new Date().toISOString() && status !== "approved",
      ),
      visualReviewAvailable: Boolean(
        job.diff && job.captures.production && job.captures.staging && !job.error,
      ),
    };
  }

  async read(actor: Actor, runId: string, jobId: string) {
    const { run, job, scopeDigest } = await this.evidence(actor, runId, jobId);
    const row = await this.state.get<ReviewThread>("reviews", this.key(run, job.id));
    return this.threadView(actor, run, job, scopeDigest, row);
  }

  private threadView(
    actor: Actor,
    run: RunDetail,
    job: JobResult,
    scopeDigest: string,
    row?: StateRecord<ReviewThread>,
  ) {
    if (row && (row.value.scopeDigest !== scopeDigest || row.value.evidenceDigest !== run.digest))
      throw new PlatformError(
        409,
        "Review evidence changed; this history cannot approve the current capture",
      );
    return this.view(
      actor,
      run,
      job,
      row?.value ?? this.empty(run, job, scopeDigest),
      row?.version ?? 0,
    );
  }

  async append(actor: Actor, runId: string, input: ReviewMutation) {
    const { run, job, scopeDigest } = await this.evidence(actor, runId, input.jobId, true);
    if (input.evidenceDigest !== run.digest || input.scopeDigest !== scopeDigest)
      throw new PlatformError(409, "Evidence changed; reopen the exact check before reviewing");
    const id = this.key(run, job.id);
    const row = await this.state.get<ReviewThread>("reviews", id);
    if ((row?.version ?? 0) !== input.expectedVersion)
      throw new PlatformError(
        409,
        "Another review was saved; refresh the thread before submitting again",
      );
    if (row && row.value.scopeDigest !== scopeDigest)
      throw new PlatformError(409, "Stored review belongs to different evidence");
    const thread = row?.value ?? this.empty(run, job, scopeDigest);
    const previousDecision = [...thread.events]
      .reverse()
      .find((item) =>
        ["approve_visual_change", "reject_visual_change", "withdraw_decision"].includes(
          item.action,
        ),
      );
    // A full discussion must never trap an approval that a reviewer needs to withdraw.
    const finalWithdrawal =
      input.event.action === "withdraw_decision" &&
      previousDecision &&
      previousDecision.action !== "withdraw_decision";
    if (input.event.action === "withdraw_decision" && !finalWithdrawal)
      throw new PlatformError(400, "There is no active decision to withdraw");
    if (thread.events.length >= 200 && !finalWithdrawal)
      throw new PlatformError(
        413,
        "This check has reached its review limit; withdraw an existing decision or start a new capture",
      );
    const event: ReviewEvent = {
      id: randomUUID(),
      actor: person(actor),
      at: new Date().toISOString(),
      action: input.event.action,
      reason: input.event.reason,
    };
    if (input.event.action === "comment" && input.event.replyTo) {
      const replyTo = input.event.replyTo;
      if (!thread.events.some((item) => item.id === replyTo))
        throw new PlatformError(400, "Reply target is not part of this check's history");
      event.replyTo = replyTo;
    }
    if (input.event.action === "assign") {
      if (!input.event.assigneeId && input.event.dueAt)
        throw new PlatformError(400, "A deadline needs an assigned reviewer");
      if (input.event.assigneeId) {
        event.assignee = await this.eligible(run.projectId, input.event.assigneeId);
        if (!event.assignee)
          throw new PlatformError(400, "Choose an active reviewer with access to this project");
      }
      if (input.event.dueAt) {
        if (Date.parse(input.event.dueAt) <= Date.now())
          throw new PlatformError(400, "Choose a future review deadline");
        event.dueAt = new Date(input.event.dueAt).toISOString();
      }
    }
    if (
      ["approve_visual_change", "reject_visual_change"].includes(event.action) &&
      (!job.diff || !job.captures.production || !job.captures.staging || job.error)
    )
      throw new PlatformError(
        400,
        "Visual decisions require a successfully compared screenshot pair",
      );
    const next = { ...thread, events: [...thread.events, event] };
    const saved = row
      ? await this.state.replace("reviews", { ...row, value: next })
      : await this.state.create("reviews", id, next);
    if (!saved)
      throw new PlatformError(
        409,
        "Another review was saved; refresh the thread before submitting again",
      );
    // Deletion can race a review across instances. Do not leave new comments on removed evidence.
    try {
      const current = await this.repository.getRun(run.id);
      if (current.digest !== run.digest)
        throw new PlatformError(409, "Run evidence changed during review");
    } catch (error) {
      if (error instanceof PlatformError && (error.status === 404 || error.status === 409))
        await this.state.remove("reviews", id, input.expectedVersion + 1);
      throw error;
    }
    // The event is already durable; a secondary audit failure must not invite a duplicate retry.
    await this.auth
      .audit(actor, `review.${event.action}`, {
        projectId: run.projectId,
        runId,
        jobId: job.id,
        eventId: event.id,
        evidenceDigest: run.digest,
        scopeDigest,
      })
      .catch((error) =>
        console.error("Review saved; unable to write secondary audit event", error),
      );
    return this.read(actor, run.id, job.id);
  }

  async inbox(
    actor: Actor,
    options: {
      project: string;
      after?: string;
      owner?: "all" | "mine" | "unassigned";
      status?: "all" | "open" | "pending" | "approved" | "rejected";
      overdue?: boolean;
    },
  ): Promise<ReviewInboxPage> {
    await this.auth.requireRole(actor, options.project);
    if (!(await this.repository.projects([options.project])).length)
      throw new PlatformError(404, "Project not found");
    const prefix = `${options.project}:`;
    if (options.after && (!options.after.startsWith(prefix) || options.after.length > 200))
      throw new PlatformError(400, "Invalid review cursor");
    const rows = await this.state.list<ReviewThread>("reviews", prefix, 51, options.after);
    const items: ReviewInboxItem[] = [];
    const runs = new Map<string, RunDetail>();
    for (const row of rows.slice(0, 50)) {
      let run = runs.get(row.value.runId);
      if (!run) {
        try {
          run = await this.repository.getRun(row.value.runId);
        } catch (error) {
          if (error instanceof PlatformError && error.status === 404) continue;
          throw error;
        }
        runs.set(run.id, run);
      }
      if (run.projectId !== options.project) continue;
      if (
        !run.manifest.jobs.some((item) => item.id === row.value.jobId) ||
        run.digest !== row.value.evidenceDigest
      )
        continue;
      const { job, scopeDigest } = this.checkEvidence(run, row.value.jobId);
      const view = await this.threadView(actor, run, job, scopeDigest, row);
      if (options.owner === "mine" && view.assignee?.id !== actor.id) continue;
      if (options.owner === "unassigned" && view.assignee) continue;
      if (options.status === "open" && view.status === "approved") continue;
      if (
        options.status &&
        options.status !== "all" &&
        options.status !== "open" &&
        view.status !== options.status
      )
        continue;
      if (options.overdue && !view.overdue) continue;
      items.push({
        cursor: row.id,
        runId: run.id,
        runNumber: run.number,
        projectId: run.projectId,
        jobId: job.id,
        name: job.name,
        route: job.route,
        viewport: job.viewport,
        sourceRevision: run.metadata.commit,
        status: view.status,
        assignee: view.assignee,
        assigneeAvailable: view.assigneeAvailable,
        dueAt: view.dueAt,
        overdue: view.overdue,
        updatedAt: view.events[view.events.length - 1]!.at,
      });
    }
    return { items, nextCursor: rows.length > 50 ? rows[49]!.id : undefined };
  }
}
