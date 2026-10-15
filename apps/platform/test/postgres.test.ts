/** Optional real-PostgreSQL contract check. Point only at a disposable validation database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase, type Database } from "../server/database.js";
import { Repository } from "../server/repository.js";
import type { RunDetail } from "../shared/contracts.js";

describe.skipIf(!process.env.VISUALGUARD_TEST_DATABASE_URL)("PostgreSQL metadata contract", () => {
  let database: Database;
  let repository: Repository;
  const projectId = `validation-${randomUUID()}`;
  beforeAll(async () => {
    database = await openDatabase({ url: process.env.VISUALGUARD_TEST_DATABASE_URL, sqlitePath: ":memory:" });
    repository = new Repository(database);
    await repository.createProject(projectId, "PostgreSQL validation");
  });
  afterAll(async () => {
    if (database) {
      await database.query("DELETE FROM vg_jobs WHERE run_id IN (SELECT id FROM vg_runs WHERE project_id=?)", [projectId]);
      await database.query("DELETE FROM vg_runs WHERE project_id=?", [projectId]);
      await database.query("DELETE FROM vg_projects WHERE id=?", [projectId]);
      await database.close();
    }
  });
  it("indexes immutable evidence, deduplicates racing imports, and returns coherent pages", async () => {
    const manifest = {
      schemaVersion: 1, id: "pg-run", number: 1, startedAt: "2026-10-15T10:00:00.000Z", durationMs: 0,
      mode: "compare", tool: { version: "2.0.0" },
      config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
      summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 }, jobs: [],
    } as RunDetail["manifest"];
    const document: Omit<RunDetail, "id"> = {
      envelopeVersion: 1, projectId, engineRunId: manifest.id, number: 1,
      startedAt: manifest.startedAt, importedAt: manifest.startedAt, durationMs: 0, mode: "compare",
      status: "incomplete", complete: false, completenessReasons: ["No checks"], summary: manifest.summary,
      metadata: { environment: "validation", branch: "branch%literal", pullRequest: 42 },
      digest: "a".repeat(64), jobCount: 0, manifest, artifacts: [],
    };
    const results = await Promise.all([repository.insertRun(document), repository.insertRun(document)]);
    expect(results[0].run.id).toBe(results[1].run.id);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    const page = await repository.runs({ project: projectId, q: "%literal", pullRequest: 42 });
    expect(page.total).toBe(1); expect(page.runs).toHaveLength(1);
    const beyond = await repository.runs({ project: projectId, offset: 99 });
    expect(beyond.total).toBe(1); expect(beyond.runs).toEqual([]);
    await expect(repository.insertRun({ ...document, digest: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect((await repository.getRun(results[0].run.id)).digest).toBe(document.digest);
  });
  it("rolls back a failed transaction", async () => {
    const id = `rollback-${randomUUID()}`;
    await expect(database.transaction(async (sql) => {
      await sql.query("INSERT INTO vg_projects(id, name, created_at) VALUES(?, ?, ?)", [id, "Rollback", new Date().toISOString()]);
      throw new Error("deliberate rollback");
    })).rejects.toThrow("deliberate rollback");
    expect(await database.query("SELECT id FROM vg_projects WHERE id=?", [id])).toEqual([]);
  });
});
