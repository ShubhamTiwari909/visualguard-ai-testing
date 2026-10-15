import { randomUUID } from "node:crypto";
import type { Database, Sql } from "./database.js";
import type { FileArtifactStore } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import { projectId } from "./validation.js";
import type { DeletionResult, Project, RunDetail, RunFilters, RunPage, StoredRun } from "../shared/contracts.js";
import type { PlatformRepository } from "./storage-contracts.js";

const brief = ({ manifest: _manifest, artifacts: _artifacts, envelopeVersion: _version, ...run }: RunDetail): StoredRun => run;

export class Repository implements PlatformRepository {
  constructor(readonly db: Database, private legacy?: FileArtifactStore) {}

  async createProject(id: string, name: string): Promise<Project> {
    projectId(id);
    if (!name.trim() || name.length > 120) throw new PlatformError(400, "Project name must contain 1–120 characters");
    await this.db.transaction(async (sql) => {
      if ((await sql.query("SELECT id FROM vg_project_tombstones WHERE id=?", [id])).length) throw new PlatformError(409, "This project ID was deleted; choose a new project ID");
      await sql.query("INSERT INTO vg_projects(id, name, created_at) VALUES(?, ?, ?) ON CONFLICT(id) DO NOTHING", [id, name.trim(), new Date().toISOString()]);
    });
    return (await this.projects()).find((project) => project.id === id)!;
  }

  async projects(allowed?: string[]): Promise<Project[]> {
    if (allowed?.length === 0) return [];
    const rows = await this.db.query<{ id: string; name: string; created_at: string; run_count: number | string }>(
      `SELECT p.id, p.name, p.created_at, COUNT(r.id) AS run_count FROM vg_projects p LEFT JOIN vg_runs r ON r.project_id=p.id${allowed ? ` WHERE p.id IN (${allowed.map(() => "?").join(",")})` : ""} GROUP BY p.id, p.name, p.created_at ORDER BY p.name, p.id`, allowed,
    );
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, runCount: Number(row.run_count) }));
  }

  async getRun(id: string): Promise<RunDetail> {
    const [row] = await this.db.query<{ document: string }>("SELECT document FROM vg_runs WHERE id=?", [id]);
    if (!row) throw new PlatformError(404, "Run not found");
    return JSON.parse(row.document) as RunDetail;
  }

  async insertRun(run: Omit<RunDetail, "id">, preserveId?: string): Promise<{ run: RunDetail; duplicate: boolean }> {
    return this.db.transaction(async (sql) => {
      const [project] = await sql.query("SELECT id FROM vg_projects WHERE id=?", [run.projectId]);
      if (!project) throw new PlatformError(404, "Project not found; create it before importing runs");
      // Recheck availability while deletion is excluded; old workspaces may use file artifacts.
      for (const hash of new Set(run.artifacts.map((item) => item.hash))) {
        if (!(await sql.query("SELECT hash FROM vg_objects WHERE hash=?", [hash])).length) {
          try { if (!this.legacy) throw new Error("Object missing"); await this.legacy.get(hash); }
          catch { throw new PlatformError(409, "Evidence was removed during publication; import or upload the run again"); }
        }
      }
      const document: RunDetail = { ...run, id: preserveId ?? randomUUID() };
      const searchable = [run.engineRunId, run.metadata.branch, run.metadata.commit, run.metadata.deployment, ...run.manifest.jobs.flatMap((job) => [job.route, job.name, job.viewport])].filter(Boolean).join(" ").toLowerCase();
      const inserted = await sql.query(
        "INSERT INTO vg_runs(id, project_id, engine_run_id, digest, started_at, status, environment, branch, revision, pull_request, deployment, document, search_text) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, engine_run_id) DO NOTHING RETURNING id",
        [document.id, run.projectId, run.engineRunId, run.digest, run.startedAt, run.status, run.metadata.environment, run.metadata.branch ?? "", run.metadata.commit ?? "", run.metadata.pullRequest ?? null, run.metadata.deployment ?? "", JSON.stringify(document), searchable],
      );
      if (!inserted.length) {
        const [existing] = await sql.query<{ document: string; digest: string }>("SELECT document, digest FROM vg_runs WHERE project_id=? AND engine_run_id=?", [run.projectId, run.engineRunId]);
        if (!existing || existing.digest !== run.digest) throw new PlatformError(409, "This engine run ID already exists with different evidence or metadata; original history is immutable");
        return { run: JSON.parse(existing.document) as RunDetail, duplicate: true };
      }
      for (const job of run.manifest.jobs)
        await sql.query("INSERT INTO vg_jobs(run_id, id, route, viewport, status) VALUES(?, ?, ?, ?, ?)", [document.id, job.id, job.route, job.viewport, job.status]);
      return { run: document, duplicate: false };
    });
  }

  private async queueCleanup(sql: Sql, hashes: Iterable<string>) {
    for (const hash of new Set(hashes)) await sql.query("INSERT INTO vg_state(namespace, id, value, version) VALUES('artifact-cleanup', ?, ?, 1) ON CONFLICT(namespace, id) DO NOTHING", [hash, JSON.stringify({ hash })]);
  }

  private async removeAccessAndUploads(sql: Sql, project?: string, runId?: string) {
    const rows = await sql.query<{ namespace: string; id: string; value: string }>("SELECT namespace, id, value FROM vg_state WHERE namespace IN ('memberships', 'tokens', 'uploads')");
    for (const row of rows) {
      const value = JSON.parse(row.value);
      if (!(project ? value.projectId === project : row.namespace === "uploads" && value.result?.id === runId)) continue;
      if (row.namespace === "uploads") {
        const prefix = `${row.id}:%`;
        const files = await sql.query<{ value: string }>("SELECT value FROM vg_state WHERE namespace='upload-files' AND id LIKE ?", [prefix]);
        await this.queueCleanup(sql, files.map((file) => JSON.parse(file.value).hash as string));
        await sql.query("DELETE FROM vg_state WHERE namespace IN ('upload-files', 'upload-chunks') AND id LIKE ?", [prefix]);
      }
      await sql.query("DELETE FROM vg_state WHERE namespace=? AND id=?", [row.namespace, row.id]);
    }
  }

  private async cleanup(runs: number): Promise<DeletionResult> {
    let artifactsDeleted = 0, cleanupPending = false;
    try {
      await this.db.transaction(async (sql) => {
        const referenced = new Set<string>();
        for (const row of await sql.query<{ document: string }>("SELECT document FROM vg_runs")) for (const artifact of (JSON.parse(row.document) as RunDetail).artifacts) referenced.add(artifact.hash);
        const pending = new Set<string>();
        for (const row of await sql.query<{ value: string }>("SELECT value FROM vg_state WHERE namespace='upload-files' AND (expires_at IS NULL OR expires_at>?)", [new Date().toISOString()])) pending.add(JSON.parse(row.value).hash);
        const candidates = await sql.query<{ id: string }>("SELECT id FROM vg_state WHERE namespace='artifact-cleanup' ORDER BY id LIMIT 1000");
        for (const { id: hash } of candidates) {
          if (!referenced.has(hash) && pending.has(hash)) { cleanupPending = true; continue; }
          if (!referenced.has(hash)) {
            // Publication and new object writes use the same database transaction lock.
            // A failed cleanup leaves its queue entry available for the next deletion.
            await this.legacy?.remove(hash);
            await sql.query("DELETE FROM vg_object_chunks WHERE hash=?", [hash]);
            await sql.query("DELETE FROM vg_objects WHERE hash=?", [hash]);
            artifactsDeleted++;
          }
          await sql.query("DELETE FROM vg_state WHERE namespace='artifact-cleanup' AND id=?", [hash]);
        }
        if ((await sql.query("SELECT id FROM vg_state WHERE namespace='artifact-cleanup' LIMIT 1")).length) cleanupPending = true;
      });
    } catch (error) { console.error("Evidence deletion completed; artifact cleanup remains queued", error); artifactsDeleted = 0; cleanupPending = true; }
    return { runs, artifactsDeleted, cleanupPending };
  }

  async deleteRun(id: string, expectedProject?: string): Promise<DeletionResult> {
    await this.db.transaction(async (sql) => {
      const [row] = await sql.query<{ document: string }>("SELECT document FROM vg_runs WHERE id=?", [id]);
      if (!row) throw new PlatformError(404, "Run not found");
      const run = JSON.parse(row.document) as RunDetail;
      if (expectedProject && run.projectId !== expectedProject) throw new PlatformError(409, "Run identity changed; refresh before deleting");
      await this.queueCleanup(sql, run.artifacts.map((item) => item.hash));
      await sql.query("DELETE FROM vg_jobs WHERE run_id=?", [id]);
      await sql.query("DELETE FROM vg_runs WHERE id=?", [id]);
      await this.removeAccessAndUploads(sql, undefined, id);
    });
    return this.cleanup(1);
  }

  async deleteProject(id: string, expectedRuns: number): Promise<DeletionResult> {
    const runs = await this.db.transaction(async (sql) => {
      if (!(await sql.query("SELECT id FROM vg_projects WHERE id=?", [id])).length) throw new PlatformError(404, "Project not found");
      const rows = await sql.query<{ document: string }>("SELECT document FROM vg_runs WHERE project_id=?", [id]);
      if (rows.length !== expectedRuns) throw new PlatformError(409, "Project run count changed; refresh and confirm deletion again");
      await this.queueCleanup(sql, rows.flatMap((row) => (JSON.parse(row.document) as RunDetail).artifacts.map((item) => item.hash)));
      await sql.query("DELETE FROM vg_jobs WHERE run_id IN (SELECT id FROM vg_runs WHERE project_id=?)", [id]);
      await sql.query("DELETE FROM vg_runs WHERE project_id=?", [id]);
      await this.removeAccessAndUploads(sql, id);
      await sql.query("INSERT INTO vg_project_tombstones(id) VALUES(?) ON CONFLICT(id) DO NOTHING", [id]);
      await sql.query("DELETE FROM vg_projects WHERE id=?", [id]);
      return rows.length;
    });
    return this.cleanup(runs);
  }

  async runs(filters: RunFilters, allowed?: string[]): Promise<RunPage> {
    const clauses: string[] = [];
    const values: Array<string | number | null> = [];
    if (allowed) {
      if (!allowed.length) return { runs: [], total: 0, limit: Math.min(100, Math.max(1, filters.limit ?? 25)), offset: Math.max(0, filters.offset ?? 0) };
      clauses.push(`project_id IN (${allowed.map(() => "?").join(",")})`); values.push(...allowed);
    }
    const fields = { project: "project_id", status: "status", environment: "environment", branch: "branch", commit: "revision", pullRequest: "pull_request", deployment: "deployment" } as const;
    for (const [key, column] of Object.entries(fields)) {
      const value = filters[key as keyof typeof fields];
      if (value !== undefined && value !== "") { clauses.push(`${column}=?`); values.push(value); }
    }
    if (filters.q) {
      clauses.push("search_text LIKE ? ESCAPE '!' ");
      values.push(`%${filters.q.toLowerCase().replace(/[!%_]/g, (character) => `!${character}`)}%`);
    }
    if (filters.from) { clauses.push("started_at>=?"); values.push(filters.from); }
    if (filters.to) { clauses.push("started_at<=?"); values.push(filters.to); }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const offset = Math.max(0, filters.offset ?? 0);
    // One statement provides a coherent page and count, including an empty page, on both engines.
    const rows = await this.db.query<{ total: number | string; document: string | null }>(
      `WITH filtered AS (SELECT document, started_at, id FROM vg_runs${where}),
       counted AS (SELECT COUNT(*) AS total FROM filtered),
       paged AS (SELECT document, started_at, id FROM filtered ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?)
       SELECT counted.total, paged.document FROM counted LEFT JOIN paged ON 1=1 ORDER BY paged.started_at DESC, paged.id DESC`,
      [...values, limit, offset],
    );
    return { runs: rows.filter((row) => row.document !== null).map((row) => brief(JSON.parse(row.document!) as RunDetail)), total: Number(rows[0]?.total ?? 0), limit, offset };
  }
}
