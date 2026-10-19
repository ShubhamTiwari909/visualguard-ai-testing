import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Actor, UploadToken } from "./auth.js";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { ProjectTestConfig, ProjectTestExecution } from "../shared/project-tests.js";
import { ProjectTests } from "./project-tests.js";

export const executionRequest = z.object({
  id: z.string().uuid(), configVersion: z.number().int().positive(),
}).strict();
export const executionLease = z.object({ id: z.string().uuid(), lease: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const executionCompletion = executionLease.extend({ runId: z.string().uuid().optional(), failed: z.boolean().optional() }).strict();
interface Execution extends ProjectTestExecution {
  config: ProjectTestConfig;
  runnerId?: string;
  leaseHash?: string;
  leaseExpiresAt?: string;
  acknowledged?: boolean;
}
const publicExecution = (job: Execution): ProjectTestExecution => ({
  id: job.id, configVersion: job.configVersion, status: job.status,
  requestedAt: job.requestedAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
  runId: job.runId, error: job.error,
});
const expired = (job: Execution) => job.status === "queued"
  ? Date.now() - Date.parse(job.requestedAt) > 5 * 60_000
  : job.status === "running" && Date.parse(job.leaseExpiresAt ?? "") <= Date.now();

export class TestExecutions {
  constructor(readonly tests: ProjectTests) {}
  private async current(project: string) {
    const row = await this.tests.state.get<Execution>("project-test-executions", project);
    if (row && expired(row.value)) {
      const next: Execution = { ...row.value, status: "failed", finishedAt: new Date().toISOString(), error: "Runner disconnected or timed out. Start the runner and request a new test." };
      if (await this.tests.state.replace("project-test-executions", { ...row, value: next }))
        return { ...row, version: row.version + 1, value: next };
      return this.tests.state.get<Execution>("project-test-executions", project);
    }
    return row;
  }
  async status(actor: Actor, project: string) {
    await this.tests.access(actor, project);
    const row = await this.current(project);
    const heartbeat = await this.tests.state.get<{ credentialId: string; seenAt: string }>("project-runner-heartbeats", project);
    const token = heartbeat && await this.tests.state.get<UploadToken>("tokens", heartbeat.value.credentialId);
    const online = Boolean(token?.value.runner && token.value.projectId === project && heartbeat && Date.now() - Date.parse(heartbeat.value.seenAt) < 30_000);
    return { execution: row ? publicExecution(row.value) : null, runnerOnline: online };
  }
  async request(actor: Actor, project: string, raw: unknown) {
    const input = executionRequest.parse(raw);
    await this.tests.access(actor, project, true);
    const settings = await this.tests.read(actor, project);
    if (!settings || settings.version !== input.configVersion)
      throw new PlatformError(409, "Save or refresh this project's configuration before running");
    const current = await this.current(project);
    if (current?.value.id === input.id) return publicExecution(current.value);
    if (current && ["queued", "running"].includes(current.value.status))
      throw new PlatformError(409, "This project already has an active test");
    if (!(await this.status(actor, project)).runnerOnline)
      throw new PlatformError(409, "Connect a runner for this project before running a test");
    const job: Execution = { id: input.id, configVersion: settings.version, config: structuredClone(settings.config), status: "queued", requestedAt: new Date().toISOString() };
    const saved = current
      ? await this.tests.state.replace("project-test-executions", { ...current, value: job })
      : await this.tests.state.create("project-test-executions", project, job);
    if (!saved) throw new PlatformError(409, "Another test was requested; refresh the project");
    await this.tests.auth.audit(actor, "project-test.requested", { projectId: project, requestId: job.id, configVersion: job.configVersion });
    return publicExecution(job);
  }
  async runner(actor: Actor, project: string, secret: string) {
    const id = sha256(secret);
    const token = await this.tests.state.get<UploadToken>("tokens", id);
    if (!secret || secret.length > 200 || !token?.value.runner || token.value.projectId !== project ||
      actor.credentialId !== id || actor.uploadProject !== project)
      throw new PlatformError(403, "An active runner credential for this project is required");
    if (!(await this.tests.repository.projects([project])).length || await this.tests.repository.isDeletedProject(project))
      throw new PlatformError(404, "Project not found");
    return id;
  }
  private async seen(project: string, runnerId: string) {
    const heartbeat = await this.tests.state.get("project-runner-heartbeats", project);
    const value = { credentialId: runnerId, seenAt: new Date().toISOString() };
    if (heartbeat) await this.tests.state.replace("project-runner-heartbeats", { ...heartbeat, value });
    else await this.tests.state.create("project-runner-heartbeats", project, value);
  }
  async claim(project: string, runnerId: string) {
    await this.seen(project, runnerId);
    const row = await this.current(project);
    if (!row || row.value.status !== "queued") return null;
    const lease = randomBytes(32).toString("hex");
    const job: Execution = { ...row.value, status: "running", runnerId, leaseHash: sha256(lease), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), startedAt: new Date().toISOString() };
    if (!(await this.tests.state.replace("project-test-executions", { ...row, value: job }))) return null;
    return { ...publicExecution(job), projectId: project, config: job.config, lease };
  }
  private async leased(project: string, runnerId: string, input: { id: string; lease: string }) {
    const row = await this.current(project);
    if (!row || row.value.id !== input.id || row.value.status !== "running" || row.value.runnerId !== runnerId || row.value.leaseHash !== sha256(input.lease))
      throw new PlatformError(409, "Test lease expired or belongs to another runner");
    return row;
  }
  async heartbeat(project: string, runnerId: string, raw: unknown) {
    const input = executionLease.parse(raw), row = await this.leased(project, runnerId, input);
    const value = { ...row.value, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    if (!(await this.tests.state.replace("project-test-executions", { ...row, value })))
      throw new PlatformError(409, "Test lease changed");
    await this.seen(project, runnerId);
    return { ok: true };
  }
  async complete(project: string, runnerId: string, raw: unknown) {
    const input = executionCompletion.parse(raw);
    if (Boolean(input.runId) === Boolean(input.failed)) throw new PlatformError(400, "Provide a result run or an execution failure");
    const previous = await this.tests.state.get<Execution>("project-test-executions", project);
    if (previous?.value.acknowledged && previous.value.id === input.id &&
      previous.value.runnerId === runnerId && previous.value.leaseHash === sha256(input.lease) &&
      (input.failed ? previous.value.status === "failed" : previous.value.runId === input.runId))
      return publicExecution(previous.value);
    const row = await this.leased(project, runnerId, input);
    if (input.runId) {
      const run = await this.tests.repository.getRun(input.runId);
      if (run.projectId !== project || run.metadata.deployment !== input.id)
        throw new PlatformError(409, "Run does not belong to this project execution");
    }
    const value: Execution = { ...row.value, acknowledged: true, status: input.failed ? "failed" : "completed", finishedAt: new Date().toISOString(), ...(input.failed ? { error: "Capture or upload failed. Check runner output; any captured evidence remains on the runner." } : { runId: input.runId }) };
    if (!(await this.tests.state.replace("project-test-executions", { ...row, value })))
      throw new PlatformError(409, "Execution changed before completion");
    const owner = await this.tests.state.get<UploadToken>("tokens", runnerId);
    await this.tests.auth.audit({ id: owner?.value.ownerId ?? "runner" }, "project-test.finished", {
      projectId: project, requestId: input.id, runId: input.runId ?? null, status: value.status,
    }).catch((error) => console.error("Test finished; unable to record audit event", error));
    return publicExecution(value);
  }
}
