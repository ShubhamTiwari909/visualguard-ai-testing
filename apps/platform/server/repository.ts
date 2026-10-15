import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";
import { PlatformError } from "./errors.js";
import { projectId } from "./validation.js";
import type { Project, RunDetail, RunFilters, RunPage, StoredRun } from "../shared/contracts.js";
import type { PlatformRepository } from "./storage-contracts.js";

const brief = ({ manifest: _manifest, artifacts: _artifacts, envelopeVersion: _version, ...run }: RunDetail): StoredRun => run;

export class Repository implements PlatformRepository {
  constructor(readonly db: Database) {}

  async createProject(id: string, name: string): Promise<Project> {
    projectId(id);
    if (!name.trim() || name.length > 120) throw new PlatformError(400, "Project name must contain 1–120 characters");
    await this.db.query("INSERT INTO vg_projects(id, name, created_at) VALUES(?, ?, ?) ON CONFLICT(id) DO NOTHING", [id, name.trim(), new Date().toISOString()]);
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

  async insertRun(run: Omit<RunDetail, "id">): Promise<{ run: RunDetail; duplicate: boolean }> {
    return this.db.transaction(async (sql) => {
      const [project] = await sql.query("SELECT id FROM vg_projects WHERE id=?", [run.projectId]);
      if (!project) throw new PlatformError(404, "Project not found; create it before importing runs");
      const document: RunDetail = { ...run, id: randomUUID() };
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
