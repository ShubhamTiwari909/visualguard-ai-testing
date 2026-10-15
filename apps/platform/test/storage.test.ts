import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/database.js";
import { Repository } from "../server/repository.js";
import { SqlStateStore } from "../server/state.js";
import { SqlArtifactStore } from "../server/artifacts.js";
import { openMongo } from "../server/mongo.js";
import type { PlatformRepository, StateStore } from "../server/storage-contracts.js";
import type { ArtifactStore } from "../server/artifacts.js";
import type { RunDetail } from "../shared/contracts.js";

for (const backend of ["sqlite", "postgres", "mongo"] as const) {
  const url = backend === "postgres" ? process.env.VISUALGUARD_TEST_DATABASE_URL : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf(backend !== "sqlite" && !url)(`${backend} shared storage contract`, () => {
    let repository: PlatformRepository, state: StateStore, store: ArtifactStore, close: () => Promise<void>, root: string;
    const prefix = `storage-${randomUUID()}`;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "vg-storage-"));
      if (backend === "mongo") ({ repository, state, store, close } = await openMongo(url!));
      else {
        const db = await openDatabase({ url: backend === "postgres" ? url : undefined, sqlitePath: join(root, "test.sqlite") });
        repository = new Repository(db); state = new SqlStateStore(db); store = new SqlArtifactStore(db); close = () => db.close();
      }
    });
    afterAll(async () => { await close?.(); if (root) await rm(root, { recursive: true, force: true }); });
    it("uses atomic versioned state and honors expiry", async () => {
      expect(await state.create(prefix, "item", { count: 1 })).toBe(true);
      expect(await state.create(prefix, "item", { count: 2 })).toBe(false);
      const first = (await state.get<{ count: number }>(prefix, "item"))!;
      const results = await Promise.all([state.replace(prefix, { ...first, value: { count: 2 } }), state.replace(prefix, { ...first, value: { count: 3 } })]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await state.remove(prefix, "item", first.version)).toBe(false);
      expect((await state.get(prefix, "item"))?.version).toBe(2);
      await state.create(prefix, "expired", {}, "2000-01-01T00:00:00.000Z");
      expect(await state.get(prefix, "expired")).toBeUndefined();
      expect(await state.create(prefix, "expired", { renewed: true })).toBe(true);
      expect((await state.list(prefix)).length).toBe(2);
      await state.create(prefix, "prune", {}, "2000-01-01T00:00:00.000Z");
      expect(await state.pruneExpired()).toBeGreaterThanOrEqual(1);
    });
    it("round-trips a multi-chunk image object and deduplicates concurrent writes", async () => {
      const bytes = randomBytes(5 * 1024 * 1024 + 17);
      const [a, b] = await Promise.all([store.put(bytes), store.put(bytes)]);
      expect(a).toBe(b); expect((await store.get(a)).equals(bytes)).toBe(true);
      expect(store.getChunk).toBeTypeOf("function");
      expect((await store.getChunk!(a, 2)).equals(bytes.subarray(2 * 1024 * 1024, 3 * 1024 * 1024))).toBe(true);
    });
    it("keeps projects scoped and history immutable under racing imports", async () => {
      const projectId = `${prefix}-a`, other = `${prefix}-b`;
      await repository.createProject(projectId, "Storage test A"); await repository.createProject(other, "Storage test B");
      const manifest = { schemaVersion: 1, id: prefix, number: 1, startedAt: "2026-10-15T10:00:00.000Z", durationMs: 0, mode: "compare", tool: { version: "2.0.0" }, config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" }, summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 }, jobs: [] } as RunDetail["manifest"];
      const input: Omit<RunDetail, "id"> = { envelopeVersion: 1, projectId, engineRunId: prefix, number: 1, startedAt: manifest.startedAt, importedAt: manifest.startedAt, durationMs: 0, mode: "compare", status: "incomplete", complete: false, completenessReasons: ["No checks"], summary: manifest.summary, metadata: { environment: "validation", branch: "literal%[x]", commit: undefined }, digest: randomBytes(32).toString("hex"), jobCount: 0, manifest, artifacts: [] };
      const [a, b] = await Promise.all([repository.insertRun(input), repository.insertRun(input)]);
      expect(a.run.id).toBe(b.run.id);
      await expect(repository.insertRun({ ...input, digest: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
      expect((await repository.runs({ project: projectId, q: "%[x]" }, [projectId])).total).toBe(1);
      expect((await repository.runs({ project: projectId }, [other])).total).toBe(0);
      expect(await repository.projects([])).toEqual([]);
      expect((await repository.runs({}, [])).total).toBe(0);
      expect((await repository.getRun(a.run.id)).manifest).toEqual(manifest);
      expect((await repository.getRun(a.run.id)).metadata.commit).toBeUndefined();
    });
  });
}
