import { randomUUID } from "node:crypto";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { ArtifactStore } from "./artifacts.js";
import { OBJECT_CHUNK_BYTES, sha256 } from "./artifacts.js";
import type { PlatformRepository, StateRecord, StateStore } from "./storage-contracts.js";
import type { Project, RunDetail, RunFilters, RunPage } from "../shared/contracts.js";
import { PlatformError } from "./errors.js";
import { projectId } from "./validation.js";

const regex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = <T>(doc: Document): T => { const { _id: _ignored, ...value } = doc; return value as T; };

export class MongoRepository implements PlatformRepository {
  constructor(private db: Db) {}
  async createProject(id: string, name: string): Promise<Project> {
    projectId(id);
    if (!name.trim() || name.length > 120) throw new PlatformError(400, "Project name must contain 1–120 characters");
    try { await this.db.collection("vg_projects").updateOne({ id }, { $setOnInsert: { id, name: name.trim(), createdAt: new Date().toISOString() } }, { upsert: true }); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; }
    return (await this.projects([id]))[0]!;
  }
  async projects(allowed?: string[]) {
    if (allowed?.length === 0) return [];
    const rows = await this.db.collection("vg_projects").aggregate([
      { $match: allowed ? { id: { $in: allowed } } : {} },
      { $lookup: { from: "vg_runs", localField: "id", foreignField: "projectId", pipeline: [{ $count: "count" }], as: "counts" } },
      { $sort: { name: 1, id: 1 } },
    ]).toArray();
    return rows.map((row) => ({ id: row.id as string, name: row.name as string, createdAt: row.createdAt as string, runCount: Number(row.counts[0]?.count ?? 0) }));
  }
  async getRun(id: string): Promise<RunDetail> {
    const run = await this.db.collection("vg_runs").findOne({ id });
    if (!run) throw new PlatformError(404, "Run not found");
    const { searchText: _search, ...detail } = clean<RunDetail & { searchText: string }>(run);
    return detail;
  }
  async insertRun(run: Omit<RunDetail, "id">) {
    if (!await this.db.collection("vg_projects").findOne({ id: run.projectId })) throw new PlatformError(404, "Project not found");
    // Leave headroom below MongoDB's BSON document limit for indexes and future envelope fields.
    if (Buffer.byteLength(JSON.stringify(run)) > 12 * 1024 * 1024) throw new PlatformError(413, "MongoDB run envelope exceeds the 12 MiB limit; split this execution into smaller complete runs");
    const document: RunDetail = { ...run, id: randomUUID() };
    const searchText = [run.engineRunId, run.metadata.branch, run.metadata.commit, run.metadata.deployment, ...run.manifest.jobs.flatMap((job) => [job.route, job.name, job.viewport])].filter(Boolean).join(" ").toLowerCase();
    try {
      await this.db.collection("vg_runs").insertOne({ ...document, searchText });
      return { run: document, duplicate: false };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      const existing = await this.db.collection("vg_runs").findOne({ projectId: run.projectId, engineRunId: run.engineRunId });
      if (!existing || existing.digest !== run.digest) throw new PlatformError(409, "This engine run ID already exists with different evidence or metadata; original history is immutable");
      return { run: await this.getRun(existing.id), duplicate: true };
    }
  }
  async runs(filters: RunFilters, allowed?: string[]): Promise<RunPage> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25)), offset = Math.max(0, filters.offset ?? 0);
    if (allowed?.length === 0 || (allowed && filters.project && !allowed.includes(filters.project))) return { runs: [], total: 0, limit, offset };
    const match: Document = {};
    if (allowed) match.projectId = { $in: allowed };
    for (const [key, field] of Object.entries({ project: "projectId", status: "status", environment: "metadata.environment", branch: "metadata.branch", commit: "metadata.commit", pullRequest: "metadata.pullRequest", deployment: "metadata.deployment" })) {
      const value = filters[key as keyof RunFilters];
      if (value !== undefined && value !== "") match[field] = value;
    }
    if (filters.q) match.searchText = { $regex: regex(filters.q.toLowerCase()) };
    if (filters.from || filters.to) match.startedAt = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
    const [result] = await this.db.collection("vg_runs").aggregate([
      { $match: match }, { $sort: { startedAt: -1, id: -1 } },
      { $facet: { counts: [{ $count: "count" }], runs: [{ $skip: offset }, { $limit: limit }, { $project: { _id: 0, manifest: 0, artifacts: 0, envelopeVersion: 0, searchText: 0 } }] } },
    ]).toArray();
    return { runs: result?.runs ?? [], total: result?.counts[0]?.count ?? 0, limit, offset };
  }
}

type MongoState = { namespace: string; id: string; value: unknown; version: number; expiresAt: string | null };
export class MongoStateStore implements StateStore {
  private collection: Collection<MongoState>;
  constructor(db: Db) { this.collection = db.collection<MongoState>("vg_state"); }
  private live() { return { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date().toISOString() } }] }; }
  async get<T>(namespace: string, id: string): Promise<StateRecord<T> | undefined> {
    const row = await this.collection.findOne({ namespace, id, ...this.live() });
    return row ? { id, value: row.value as T, version: row.version, expiresAt: row.expiresAt ?? undefined } : undefined;
  }
  async create<T>(namespace: string, id: string, value: T, expiresAt?: string) {
    await this.collection.deleteOne({ namespace, id, expiresAt: { $ne: null, $lte: new Date().toISOString() } });
    try { await this.collection.insertOne({ namespace, id, value, version: 1, expiresAt: expiresAt ?? null }); return true; }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === 11000) return false; throw error; }
  }
  async replace<T>(namespace: string, item: StateRecord<T>) {
    return (await this.collection.updateOne({ namespace, id: item.id, version: item.version, ...this.live() }, { $set: { value: item.value, expiresAt: item.expiresAt ?? null }, $inc: { version: 1 } })).modifiedCount === 1;
  }
  async remove(namespace: string, id: string, version?: number) { return (await this.collection.deleteOne({ namespace, id, ...(version === undefined ? {} : { version }) })).deletedCount === 1; }
  async list<T>(namespace: string, prefix = "", limit = 1000): Promise<StateRecord<T>[]> {
    const rows = await this.collection.find({ namespace, id: { $regex: `^${regex(prefix)}` }, ...this.live() }).sort({ id: 1 }).limit(limit).toArray();
    return rows.map((row) => ({ id: row.id, value: row.value as T, version: row.version, expiresAt: row.expiresAt ?? undefined }));
  }
}

export class MongoArtifactStore implements ArtifactStore {
  constructor(private db: Db) {}
  async put(bytes: Uint8Array) {
    const hash = sha256(bytes), chunks = Math.max(1, Math.ceil(bytes.length / OBJECT_CHUNK_BYTES));
    for (let index = 0; index < chunks; index++) {
      const key = `${hash}:${index}`;
      try { await this.db.collection("vg_object_chunks").updateOne({ key }, { $setOnInsert: { key, hash, chunk: index, data: Buffer.from(bytes.subarray(index * OBJECT_CHUNK_BYTES, (index + 1) * OBJECT_CHUNK_BYTES)).toString("base64") } }, { upsert: true }); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; }
    }
    try { await this.db.collection("vg_objects").updateOne({ hash }, { $setOnInsert: { hash, size: bytes.length, chunks } }, { upsert: true }); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; }
    return hash;
  }
  async get(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
    const meta = await this.db.collection("vg_objects").findOne({ hash });
    if (!meta) throw new Error("Artifact object not found");
    const rows = await this.db.collection("vg_object_chunks").find({ hash }).sort({ chunk: 1 }).toArray();
    const data = Buffer.concat(rows.map((row) => Buffer.from(row.data, "base64")));
    if (rows.length !== meta.chunks || data.length !== meta.size || sha256(data) !== hash) throw new Error("Stored artifact checksum mismatch");
    return data;
  }
}

export async function openMongo(url: string) {
  const client = new MongoClient(url, { maxPoolSize: 5, serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const name = decodeURIComponent(url.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1] ?? "");
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("MongoDB URL must include a database name");
    const db = client.db(name);
    await Promise.all([
      db.collection("vg_projects").createIndex({ id: 1 }, { unique: true }),
      db.collection("vg_runs").createIndex({ id: 1 }, { unique: true }),
      db.collection("vg_runs").createIndex({ projectId: 1, engineRunId: 1 }, { unique: true }),
      db.collection("vg_runs").createIndex({ projectId: 1, startedAt: -1, id: -1 }),
      db.collection("vg_state").createIndex({ namespace: 1, id: 1 }, { unique: true }),
      db.collection("vg_objects").createIndex({ hash: 1 }, { unique: true }),
      db.collection("vg_object_chunks").createIndex({ key: 1 }, { unique: true }),
    ]);
    return { repository: new MongoRepository(db), state: new MongoStateStore(db), store: new MongoArtifactStore(db), close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}
