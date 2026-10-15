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
import { AuthService } from "../server/auth.js";
import { Reviews } from "../server/reviews.js";
import { reviewRun } from "./fixtures/review-run.js";

for (const backend of ["sqlite", "postgres", "mongo"] as const) {
  const url =
    backend === "postgres"
      ? process.env.VISUALGUARD_TEST_DATABASE_URL
      : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf(backend !== "sqlite" && !url)(`${backend} shared storage contract`, () => {
    let repository: PlatformRepository,
      state: StateStore,
      store: ArtifactStore,
      close: () => Promise<void>,
      root: string;
    const prefix = `storage-${randomUUID()}`;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "vg-storage-"));
      if (backend === "mongo") ({ repository, state, store, close } = await openMongo(url!));
      else {
        const db = await openDatabase({
          url: backend === "postgres" ? url : undefined,
          sqlitePath: join(root, "test.sqlite"),
        });
        repository = new Repository(db);
        state = new SqlStateStore(db);
        store = new SqlArtifactStore(db);
        close = () => db.close();
      }
    });
    afterAll(async () => {
      await close?.();
      if (root) await rm(root, { recursive: true, force: true });
    });
    it("uses atomic versioned state and honors expiry", async () => {
      expect(await state.create(prefix, "item", { count: 1 })).toBe(true);
      expect(await state.create(prefix, "item", { count: 2 })).toBe(false);
      const first = (await state.get<{ count: number }>(prefix, "item"))!;
      const results = await Promise.all([
        state.replace(prefix, { ...first, value: { count: 2 } }),
        state.replace(prefix, { ...first, value: { count: 3 } }),
      ]);
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
    it("persists exact review history across instances, pages state, and removes reviews with evidence", async () => {
      const projectId = `${prefix}-reviews`;
      await repository.createProject(projectId, "Review storage");
      const input = reviewRun();
      input.projectId = projectId;
      const { id: _id, ...document } = input;
      const { run } = await repository.insertRun(document);
      const auth = new AuthService(state, { VISUALGUARD_AUTH_MODE: "local" });
      const actor = { id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: "" };
      const reviews = new Reviews(repository, state, auth);
      const first = await reviews.read(actor, run.id, "checkout__desktop");
      const mutation = { jobId: first.jobId, evidenceDigest: first.evidenceDigest,
        scopeDigest: first.scopeDigest, expectedVersion: 0,
        event: { action: "comment" as const, reason: "Shared review history" } };
      const results = await Promise.allSettled([
        reviews.append(actor, run.id, mutation), reviews.append(actor, run.id, mutation),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const otherInstance = new Reviews(repository, state, new AuthService(state, { VISUALGUARD_AUTH_MODE: "local" }));
      expect((await otherInstance.read(actor, run.id, first.jobId)).events).toHaveLength(1);
      const keyPrefix = `${projectId}:`;
      const [row] = await state.list("reviews", keyPrefix, 1);
      expect(row).toBeDefined();
      expect(await state.list("reviews", keyPrefix, 1, row!.id)).toEqual([]);
      await repository.deleteRun(run.id, projectId);
      expect(await state.list("reviews", keyPrefix)).toEqual([]);
      const second = await repository.insertRun({ ...document, engineRunId: `${document.engineRunId}-again` });
      const view = await reviews.read(actor, second.run.id, first.jobId);
      await reviews.append(actor, second.run.id, { ...mutation, scopeDigest: view.scopeDigest });
      await repository.deleteProject(projectId, 1);
      expect(await state.list("reviews", keyPrefix)).toEqual([]);
    });
    it("creates a project once under racing requests and preserves its existing name", async () => {
      const id = `${prefix}-ensure`;
      const results = await Promise.all([
        repository.ensureProject(id, "Initial name"),
        repository.ensureProject(id, "Other initial name"),
      ]);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results.map((result) => result.project.id)).toEqual([id, id]);
      const original = results.find((result) => result.created)!.project;
      const repeated = await repository.ensureProject(id, "Should not rename");
      expect(repeated.created).toBe(false);
      expect(repeated.project.name).toBe(original.name);
      expect(repeated.project.createdAt).toBe(original.createdAt);
      expect(repeated.project.runCount).toBe(0);
      expect(await repository.projects([id])).toHaveLength(1);
    });
    it("round-trips a multi-chunk image object and deduplicates concurrent writes", async () => {
      const bytes = randomBytes(5 * 1024 * 1024 + 17);
      const [a, b] = await Promise.all([store.put(bytes), store.put(bytes)]);
      expect(a).toBe(b);
      expect((await store.get(a)).equals(bytes)).toBe(true);
      expect(store.getChunk).toBeTypeOf("function");
      expect(
        (await store.getChunk!(a, 2)).equals(bytes.subarray(2 * 1024 * 1024, 3 * 1024 * 1024)),
      ).toBe(true);
    });
    it("keeps projects scoped and history immutable under racing imports", async () => {
      const projectId = `${prefix}-a`,
        other = `${prefix}-b`;
      await repository.createProject(projectId, "Storage test A");
      await repository.createProject(other, "Storage test B");
      const manifest = {
        schemaVersion: 1,
        id: prefix,
        number: 1,
        startedAt: "2026-10-15T10:00:00.000Z",
        durationMs: 0,
        mode: "compare",
        tool: { version: "2.0.0" },
        config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
        summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 },
        jobs: [],
      } as RunDetail["manifest"];
      const input: Omit<RunDetail, "id"> = {
        envelopeVersion: 1,
        projectId,
        engineRunId: prefix,
        number: 1,
        startedAt: manifest.startedAt,
        importedAt: manifest.startedAt,
        durationMs: 0,
        mode: "compare",
        status: "incomplete",
        complete: false,
        completenessReasons: ["No checks"],
        summary: manifest.summary,
        metadata: { environment: "validation", branch: "literal%[x]", commit: undefined },
        digest: randomBytes(32).toString("hex"),
        jobCount: 0,
        manifest,
        artifacts: [],
      };
      const [a, b] = await Promise.all([repository.insertRun(input), repository.insertRun(input)]);
      expect(a.run.id).toBe(b.run.id);
      await expect(
        repository.insertRun({ ...input, digest: "0".repeat(64) }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await repository.runs({ project: projectId, q: "%[x]" }, [projectId])).total).toBe(1);
      expect((await repository.runs({ project: projectId }, [other])).total).toBe(0);
      expect(await repository.projects([])).toEqual([]);
      expect((await repository.runs({}, [])).total).toBe(0);
      expect((await repository.getRun(a.run.id)).manifest).toEqual(manifest);
      expect((await repository.getRun(a.run.id)).metadata.commit).toBeUndefined();
    });
    it("deletes runs while preserving evidence shared across projects", async () => {
      const first = `${prefix}-delete-a`,
        second = `${prefix}-delete-b`;
      await repository.createProject(first, "Delete A");
      await repository.createProject(second, "Delete B");
      const bytes = Buffer.from(JSON.stringify({ evidence: randomUUID() })),
        hash = await store.put(bytes);
      const manifest = {
        schemaVersion: 1,
        id: "delete-run",
        number: 1,
        startedAt: "2026-10-15T10:00:00.000Z",
        durationMs: 0,
        mode: "compare",
        tool: { version: "2.0.0" },
        config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
        summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 },
        jobs: [],
      } as RunDetail["manifest"];
      const input: Omit<RunDetail, "id"> = {
        envelopeVersion: 1,
        projectId: first,
        engineRunId: manifest.id,
        number: 1,
        startedAt: manifest.startedAt,
        importedAt: manifest.startedAt,
        durationMs: 0,
        mode: "compare",
        status: "incomplete",
        complete: false,
        completenessReasons: ["No checks"],
        summary: manifest.summary,
        metadata: { environment: "deletion" },
        digest: randomBytes(32).toString("hex"),
        jobCount: 0,
        manifest,
        artifacts: [
          { path: "evidence.json", hash, size: bytes.length, mediaType: "application/json" },
        ],
      };
      const a = await repository.insertRun(input),
        b = await repository.insertRun({ ...input, projectId: second });
      expect((await repository.deleteRun(a.run.id)).runs).toBe(1);
      await expect(repository.getRun(a.run.id)).rejects.toMatchObject({ status: 404 });
      expect((await store.get(hash)).equals(bytes)).toBe(true);
      expect((await repository.getRun(b.run.id)).digest).toBe(input.digest);
      expect((await repository.projects([first]))[0]?.runCount).toBe(0);
      expect((await repository.deleteRun(b.run.id)).artifactsDeleted).toBeGreaterThanOrEqual(1);
      await expect(store.get(hash)).rejects.toThrow("not found");
      await store.put(bytes);
      const c = await repository.insertRun(input);
      const [deletion, publication] = await Promise.allSettled([
        repository.deleteRun(c.run.id),
        repository.insertRun({ ...input, projectId: second }),
      ]);
      expect(deletion.status).toBe("fulfilled");
      if (publication.status === "fulfilled") {
        expect((await store.get(hash)).equals(bytes)).toBe(true);
        expect((await repository.getRun(publication.value.run.id)).artifacts[0]?.hash).toBe(hash);
      } else expect(publication.reason).toMatchObject({ status: 409 });
    });
    it("checks project counts and removes project access and upload state without reusing its ID", async () => {
      const projectId = `${prefix}-delete-project`,
        other = `${prefix}-keep-project`;
      await repository.createProject(projectId, "Delete project");
      await repository.createProject(other, "Keep project");
      const upload = randomBytes(32).toString("hex"),
        bytes = Buffer.from(JSON.stringify({ temporary: randomUUID() })),
        hash = await store.put(bytes);
      await state.create("memberships", `${prefix}:member`, {
        projectId,
        userId: "member",
        role: "maintainer",
      });
      await state.create("tokens", `${prefix}:token`, { projectId, ownerId: "member" });
      await state.create("tokens", `${prefix}:keep`, { projectId: other, ownerId: "member" });
      await state.create("uploads", upload, { projectId });
      await state.create("upload-files", `${upload}:file`, { hash, complete: true });
      await state.create("upload-chunks", `${upload}:file:0`, { data: "temporary" });
      await expect(repository.deleteProject(projectId, 1)).rejects.toMatchObject({ status: 409 });
      expect(await repository.projects([projectId])).toHaveLength(1);
      expect((await repository.deleteProject(projectId, 0)).runs).toBe(0);
      expect(await repository.projects([projectId])).toEqual([]);
      expect(await state.get("memberships", `${prefix}:member`)).toBeUndefined();
      expect(await state.get("tokens", `${prefix}:token`)).toBeUndefined();
      expect(await state.get("tokens", `${prefix}:keep`)).toBeDefined();
      expect(await state.list("upload-files", `${upload}:`)).toEqual([]);
      expect(await state.list("upload-chunks", `${upload}:`)).toEqual([]);
      expect(await state.get("uploads", upload)).toBeUndefined();
      await expect(store.get(hash)).rejects.toThrow("not found");
      await expect(repository.createProject(projectId, "Reused ID")).rejects.toMatchObject({
        status: 409,
      });
    });
  });
}
