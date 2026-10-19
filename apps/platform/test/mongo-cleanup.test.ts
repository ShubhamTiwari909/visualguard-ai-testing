import { describe, expect, it, vi } from "vitest";
import { MongoBulkWriteError, type BulkWriteResult, type Db, type Document } from "mongodb";
import { cleanupMongoArtifacts, queueMongoArtifactCleanup } from "../server/mongo-cleanup.js";

function database() {
  const rows: Record<string, Document[]> = {
    vg_state: [], vg_runs: [], vg_objects: [], vg_object_chunks: [],
  };
  let active = 0, peak = 0, sequence = 0;
  const values = (document: Document, path: string[]): unknown[] => {
    if (!path.length) return [document];
    if (Array.isArray(document)) return document.flatMap((item) => values(item, path));
    return values(document?.[path[0]!], path.slice(1));
  };
  const matches = (document: Document, filter: Document): boolean =>
    Object.entries(filter).every(([key, wanted]) => {
      if (key === "$or") return wanted.some((entry: Document) => matches(document, entry));
      return values(document, key.split(".")).some((value) => {
        if (wanted && typeof wanted === "object") {
          if ("$exists" in wanted) return (value !== undefined) === wanted.$exists;
          if ("$size" in wanted) return Array.isArray(value) && value.length === wanted.$size;
          if ("$in" in wanted) return wanted.$in.includes(value);
          if ("$gt" in wanted) return typeof value === "string" && value > wanted.$gt;
        }
        return value === wanted;
      });
    });
  const call = async <T>(work: () => T) => {
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    try { return work(); } finally { active--; }
  };
  const update = (name: string, filter: Document, change: Document) => {
    let row = rows[name]!.find((item) => matches(item, filter));
    if (!row) {
      row = { _id: ++sequence, ...filter, ...change.$setOnInsert };
      rows[name]!.push(row);
    }
    for (const [key, amount] of Object.entries(change.$inc ?? {}))
      row[key] = (row[key] ?? 0) + Number(amount);
  };
  let failChunks = false;
  let beforeObjectDelete: ((filter: Document) => void) | undefined;
  let beforeChunkDelete: ((filter: Document) => void) | undefined;
  const bulkWrite = vi.fn(async (operations: Document[]) => call(() => {
    for (const operation of operations)
      update("vg_state", operation.updateOne.filter, operation.updateOne.update);
  }));
  const db = { collection(name: string) {
    return {
      bulkWrite,
      find(filter: Document) {
        let limit = Infinity;
        return {
          limit(value: number) { limit = value; return this; },
          toArray: () => call(() => rows[name]!.filter((item) => matches(item, filter)).slice(0, limit).map((item) => structuredClone(item))),
        };
      },
      findOne: (filter: Document) => call(() => structuredClone(rows[name]!.find((item) => matches(item, filter)) ?? null)),
      updateOne: (filter: Document, change: Document) => call(() => update(name, filter, change)),
      findOneAndDelete: (filter: Document) => call(() => {
        beforeObjectDelete?.(filter);
        const index = rows[name]!.findIndex((item) => matches(item, filter));
        return index === -1 ? null : rows[name]!.splice(index, 1)[0];
      }),
      deleteOne: (filter: Document) => call(() => {
        const index = rows[name]!.findIndex((item) => matches(item, filter));
        if (index !== -1) rows[name]!.splice(index, 1);
      }),
      deleteMany: (filter: Document) => call(() => {
        beforeChunkDelete?.(filter);
        if (failChunks) throw new Error("chunk deletion interrupted");
        rows[name] = rows[name]!.filter((item) => !matches(item, filter));
      }),
    };
  } } as unknown as Db;
  const artifact = (hash: string, generation = "original") => {
    rows.vg_objects!.push({ hash, generation, runRefs: [] });
    rows.vg_object_chunks!.push({ hash, generation, data: "evidence" });
  };
  return {
    db, rows, bulkWrite, artifact,
    get active() { return active; }, get peak() { return peak; },
    set failChunks(value: boolean) { failChunks = value; },
    set beforeObjectDelete(value: (filter: Document) => void) { beforeObjectDelete = value; },
    set beforeChunkDelete(value: (filter: Document) => void) { beforeChunkDelete = value; },
  };
}

describe("MongoDB deletion cleanup", () => {
  it("queues distinct hashes in one acknowledged batch, including refreshed queue versions", async () => {
    const f = database();
    await queueMongoArtifactCleanup(f.db, []);
    expect(f.bulkWrite).not.toHaveBeenCalled();
    await queueMongoArtifactCleanup(f.db, ["a", "b", "a"]);
    expect(f.bulkWrite).toHaveBeenCalledTimes(1);
    expect(f.rows.vg_state).toHaveLength(2);
    await queueMongoArtifactCleanup(f.db, ["a"]);
    expect(f.rows.vg_state!.find((row) => row.id === "a")?.version).toBe(2);
    f.bulkWrite.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(queueMongoArtifactCleanup(f.db, ["c"])).rejects.toThrow("queue unavailable");
  });

  it("ignores only duplicate upsert races and propagates mixed bulk failures", async () => {
    const f = database();
    const failure = (codes: number[]) => new MongoBulkWriteError(
      { message: "bulk failure", code: codes[0]! },
      {
        getWriteErrors: () => codes.map((code) => ({ code })),
        getWriteConcernError: () => undefined,
      } as unknown as BulkWriteResult,
    );
    f.bulkWrite.mockRejectedValueOnce(failure([11000]));
    await expect(queueMongoArtifactCleanup(f.db, ["shared"])).resolves.toBeUndefined();
    f.bulkWrite.mockRejectedValueOnce(failure([11000, 13]));
    await expect(queueMongoArtifactCleanup(f.db, ["other"])).rejects.toThrow("bulk failure");
  });

  it("cleans many artifacts concurrently within the pool budget and finishes all work before returning", async () => {
    const f = database(), hashes = Array.from({ length: 24 }, (_, index) => `hash-${index}`);
    hashes.forEach((hash) => f.artifact(hash));
    await queueMongoArtifactCleanup(f.db, hashes);
    expect(await cleanupMongoArtifacts(f.db, 1)).toEqual({ runs: 1, artifactsDeleted: 24, cleanupPending: false });
    expect(f.peak).toBeGreaterThan(1);
    expect(f.peak).toBeLessThanOrEqual(4);
    expect(f.active).toBe(0);
    expect(f.rows.vg_object_chunks).toEqual([]);
    expect(f.rows.vg_objects).toEqual([]);
    expect(f.rows.vg_state).toEqual([]);
  });

  it("preserves legacy shared evidence, live uploads and an object pinned during deletion", async () => {
    const f = database();
    ["shared", "upload", "pinned"].forEach((hash) => f.artifact(hash));
    f.rows.vg_runs!.push({ artifacts: [{ hash: "shared" }] });
    f.rows.vg_state!.push({ namespace: "upload-files", id: "upload:0", value: { hash: "upload" }, expiresAt: null });
    f.beforeObjectDelete = (filter) => {
      if (filter.hash === "pinned") f.rows.vg_objects!.find((row) => row.hash === "pinned")!.runRefs = ["concurrent-run"];
    };
    await queueMongoArtifactCleanup(f.db, ["shared", "upload", "pinned"]);
    expect(await cleanupMongoArtifacts(f.db, 1)).toMatchObject({ artifactsDeleted: 0, cleanupPending: true });
    expect(f.rows.vg_objects).toHaveLength(3);
    expect(f.rows.vg_object_chunks).toHaveLength(3);
  });

  it("retains durable tasks after a chunk failure and completes them on retry", async () => {
    const f = database();
    for (const hash of ["a", "b", "c", "d", "e"]) f.artifact(hash);
    await queueMongoArtifactCleanup(f.db, ["a", "b", "c", "d", "e"]);
    f.failChunks = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await cleanupMongoArtifacts(f.db, 1)).toMatchObject({ cleanupPending: true });
      expect(f.active).toBe(0);
      expect(f.rows.vg_state!.some((row) => row.namespace === "artifact-generations")).toBe(true);
    } finally { log.mockRestore(); }
    f.failChunks = false;
    expect(await cleanupMongoArtifacts(f.db, 0)).toMatchObject({ cleanupPending: false });
    expect(f.rows.vg_state).toEqual([]);
    expect(f.rows.vg_object_chunks).toEqual([]);
  });

  it("never removes a concurrent re-upload's newer generation", async () => {
    const f = database();
    f.artifact("reused");
    f.beforeChunkDelete = (filter) => {
      if (filter.hash === "reused" && !f.rows.vg_objects!.some((row) => row.hash === "reused")) f.artifact("reused", "replacement");
    };
    await queueMongoArtifactCleanup(f.db, ["reused"]);
    expect(await cleanupMongoArtifacts(f.db, 1)).toMatchObject({ artifactsDeleted: 1, cleanupPending: false });
    expect(f.rows.vg_objects).toEqual([{ hash: "reused", generation: "replacement", runRefs: [] }]);
    expect(f.rows.vg_object_chunks).toEqual([{ hash: "reused", generation: "replacement", data: "evidence" }]);
  });
});
