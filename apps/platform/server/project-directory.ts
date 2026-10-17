import type { Project, RunDetail, RunFilters } from "../shared/contracts.js";
import type { EvidenceRepository, PlatformRepository, StateStore } from "./storage-contracts.js";
import { PlatformError } from "./errors.js";
import type { ProjectGuard } from "./invitations.js";
import { randomUUID } from "node:crypto";
import { prepareBaselineRun, type BaselineRunGuard } from "./baseline-guards.js";
import { projectId } from "./validation.js";

interface Profile {
  name: string;
  publicId: string;
  aliases: string[];
}
interface Reservation {
  projectId: string;
}

/** Public IDs are permanent reservations; run/access/upload keys never need to migrate. */
export class ProjectDirectory implements PlatformRepository {
  constructor(
    private evidence: EvidenceRepository,
    private names: StateStore,
  ) {}

  private async decorate(project: Project): Promise<Project> {
    const row = await this.names.get<Profile>("project-profiles", project.id);
    return row ? { ...project, ...row.value, version: row.version } : project;
  }

  async resolveProjectId(id: string): Promise<string> {
    const claim = await this.names.get<Reservation>("project-ids", id);
    if (!claim || claim.value.projectId === id) return id;
    const profile = await this.names.get<Profile>("project-profiles", claim.value.projectId);
    // A reservation becomes an alias only after the profile CAS commits it.
    return profile?.value.aliases.includes(id) ? claim.value.projectId : id;
  }

  private async reserve(id: string, owner: string) {
    if (await this.evidence.isDeletedProject(id))
      throw new PlatformError(409, "This project ID was deleted and cannot be reused");
    const collision = (await this.evidence.projects([id]))[0];
    if (collision && collision.id !== owner)
      throw new PlatformError(409, "This project ID belongs to another project");
    await this.names.create<Reservation>("project-ids", id, { projectId: owner });
    const claim = await this.names.get<Reservation>("project-ids", id);
    if (!claim || claim.value.projectId !== owner)
      throw new PlatformError(409, "This project ID is reserved; choose a different ID");
  }

  async ensureProject(id: string, name: string): Promise<{ project: Project; created: boolean }> {
    projectId(id);
    if (!name.trim() || name.length > 120)
      throw new PlatformError(400, "Project name must contain 1–120 characters");
    const claim = await this.names.get<Reservation>("project-ids", id);
    if (claim && claim.value.projectId !== id) {
      const canonical = await this.resolveProjectId(id);
      const existing = canonical !== id ? (await this.projects([canonical]))[0] : undefined;
      if (!existing)
        throw new PlatformError(
          409,
          "This project ID is reserved by a deleted project or an unfinished rename",
        );
      return { project: existing, created: false };
    }
    // A concurrent rename may reserve the ID between the read and create. Resolve the winner.
    await this.names.create<Reservation>("project-ids", id, { projectId: id });
    const winner = await this.names.get<Reservation>("project-ids", id);
    if (winner?.value.projectId !== id) return this.ensureProject(id, name);
    const result = await this.evidence.ensureProject(id, name);
    return { ...result, project: await this.decorate(result.project) };
  }

  async createProject(id: string, name: string) {
    return (await this.ensureProject(id, name)).project;
  }

  async projects(allowed?: string[]) {
    const projects = await Promise.all(
      (await this.evidence.projects(allowed)).map((project) => this.decorate(project)),
    );
    return projects.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  }

  async updateProject(
    id: string,
    name: string,
    publicId: string,
    expectedVersion: number,
  ): Promise<Project> {
    id = await this.resolveProjectId(id);
    const [project] = await this.evidence.projects([id]);
    if (!project) throw new PlatformError(404, "Project not found");
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120)
      throw new PlatformError(400, "Project name must contain 1–120 characters");
    projectId(publicId);
    const row = await this.names.get<Profile>("project-profiles", id);
    if ((row?.version ?? 0) !== expectedVersion)
      throw new PlatformError(409, "Project details changed; refresh before saving again");
    const value: Profile = {
      name: trimmed,
      publicId,
      aliases: [...new Set([id, ...(row?.value.aliases ?? []), publicId])],
    };
    if (value.aliases.length > 1000)
      throw new PlatformError(413, "This project has reached its 1000 reserved ID limit");
    await this.reserve(id, id);
    await this.reserve(publicId, id);
    const saved = row
      ? await this.names.replace("project-profiles", { ...row, value })
      : await this.names.create("project-profiles", id, value);
    if (!saved)
      throw new PlatformError(409, "Project details changed; refresh before saving again");
    const [current] = await this.evidence.projects([id]);
    if (!current) {
      await this.names.remove("project-profiles", id, expectedVersion + 1);
      throw new PlatformError(404, "Project was deleted while saving its name");
    }
    return { ...current, ...value, version: expectedVersion + 1 };
  }

  getRun(id: string) {
    return this.evidence.getRun(id);
  }
  isDeletedProject(id: string) {
    return this.evidence.isDeletedProject(id);
  }
  renameRun(id: string, name: string, expectedVersion: number) {
    return this.evidence.renameRun(id, name, expectedVersion);
  }
  async insertRun(run: Omit<RunDetail, "id">, preserveId?: string) {
    const previousGuard = preserveId
      ? await this.names.get<BaselineRunGuard>("baseline-runs", preserveId)
      : undefined;
    if (previousGuard?.value.status === "deleting")
      throw new PlatformError(
        409,
        "Run deletion is still in progress; retry restoration after it completes",
      );
    const result = await this.evidence.insertRun(
      { ...run, projectId: await this.resolveProjectId(run.projectId) },
      preserveId,
    );
    // A portable restore may recreate a deleted, unretained run with its original ID.
    // Only a completed deletion can be reopened; cleanup must finish before any ID reuse.
    if (
      result.run.id === preserveId &&
      previousGuard?.value.status === "deleted" &&
      !previousGuard.value.pinned
    )
      await this.names.replace("baseline-runs", {
        ...previousGuard,
        value: { status: "active", pinned: false },
      });
    return result;
  }
  async runs(filters: RunFilters, allowed?: string[]) {
    return this.evidence.runs(
      {
        ...filters,
        project: filters.project ? await this.resolveProjectId(filters.project) : undefined,
      },
      allowed,
    );
  }
  async deleteRun(id: string, expectedProject?: string) {
    await prepareBaselineRun(this.names, id);
    const guard = await this.names.get<BaselineRunGuard>("baseline-runs", id);
    if (!guard || guard.value.status !== "active")
      throw new PlatformError(409, "Run deletion is already in progress");
    if (guard.value.pinned)
      throw new PlatformError(
        409,
        "This run is retained by approved baseline history; delete the project to remove its entire history",
      );
    if (
      !(await this.names.replace("baseline-runs", {
        ...guard,
        value: { ...guard.value, status: "deleting" },
      }))
    )
      throw new PlatformError(409, "Run changed; refresh before deleting");
    let result;
    try {
      result = await this.evidence.deleteRun(id, expectedProject);
    } catch (error) {
      if (error instanceof PlatformError && [404, 409].includes(error.status)) {
        let missing = false,
          certain = true;
        if (error.status === 404) {
          // MongoDB also returns 404 for a wrong project confirmation. Only a verified
          // absence permits ID reuse; a storage read failure must leave the guard closed.
          try {
            await this.evidence.getRun(id);
          } catch (lookup) {
            if (lookup instanceof PlatformError && lookup.status === 404) missing = true;
            else certain = false;
          }
        }
        if (certain)
          await this.names.replace("baseline-runs", {
            ...guard,
            version: guard.version + 1,
            value: missing ? { status: "deleted", pinned: false } : guard.value,
          });
      }
      throw error;
    }
    if (
      !(await this.names.replace("baseline-runs", {
        ...guard,
        version: guard.version + 1,
        value: { status: "deleted", pinned: false },
      }))
    )
      throw new PlatformError(
        409,
        "Run was deleted but its deletion guard changed; inspect storage before restoring",
      );
    return result;
  }
  async deleteProject(id: string, expectedRuns: number) {
    id = await this.resolveProjectId(id);
    await this.names.create<ProjectGuard>("invitation-projects", id, { status: "active" });
    const guard = await this.names.get<ProjectGuard>("invitation-projects", id);
    if (!guard || guard.value.status !== "active")
      throw new PlatformError(409, "Project deletion is already in progress");
    guard.value = { status: "deleting", operation: randomUUID() };
    if (!(await this.names.replace("invitation-projects", guard)))
      throw new PlatformError(409, "Project changed; retry deletion");
    let result;
    try {
      result = await this.evidence.deleteProject(id, expectedRuns);
    } catch (error) {
      // A failed confirmation has made no destructive changes. Other failures stay closed for recovery.
      if (
        error instanceof PlatformError &&
        error.status === 409 &&
        !(await this.evidence.isDeletedProject(id))
      )
        await this.names.replace("invitation-projects", {
          ...guard,
          version: guard.version + 1,
          value: { status: "active" },
        });
      throw error;
    }
    for (const namespace of ["baseline-heads", "baseline-versions"]) {
      for (;;) {
        const rows = await this.names.list(namespace, `${id}:`, 100);
        if (!rows.length) break;
        for (const row of rows) await this.names.remove(namespace, row.id, row.version);
      }
    }
    await this.names.remove("project-profiles", id);
    // Reservations deliberately survive deletion, preventing old aliases from changing owners.
    return result;
  }
}
