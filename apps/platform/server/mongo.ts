import { randomUUID } from "node:crypto";
import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { ArtifactStore } from "./artifacts.js";
import { OBJECT_CHUNK_BYTES, sha256 } from "./artifacts.js";
import type { PlatformRepository, StateRecord, StateStore } from "./storage-contracts.js";
import type {
  DeletionResult,
  Project,
  RunDetail,
  RunFilters,
  RunPage,
} from "../shared/contracts.js";
import { PlatformError } from "./errors.js";
import { projectId } from "./validation.js";

const regex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = <T>(doc: Document): T => {
  const { _id: _ignored, ...value } = doc;
  return value as T;
};
interface MongoObject {
  hash: string;
  size: number;
  chunks: number;
  generation?: string;
  runRefs?: string[];
}

export class MongoRepository implements PlatformRepository {
  constructor(private db: Db) {}
  async createProject(id: string, name: string): Promise<Project> {
    return (await this.ensureProject(id, name)).project;
  }
  async ensureProject(id: string, name: string): Promise<{ project: Project; created: boolean }> {
    projectId(id);
    if (!name.trim() || name.length > 120)
      throw new PlatformError(400, "Project name must contain 1–120 characters");
    if (await this.db.collection("vg_project_tombstones").findOne({ id }))
      throw new PlatformError(409, "This project ID was deleted; choose a new project ID");
    let created = false;
    try {
      created =
        (
          await this.db
            .collection("vg_projects")
            .updateOne(
              { id },
              { $setOnInsert: { id, name: name.trim(), createdAt: new Date().toISOString() } },
              { upsert: true },
            )
        ).upsertedCount === 1;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
    }
    const project = await this.db.collection("vg_projects").findOne({ id });
    if (await this.db.collection("vg_project_tombstones").findOne({ id })) {
      await this.db.collection("vg_projects").deleteOne({ id, deleting: { $ne: true } });
      throw new PlatformError(409, "This project ID was deleted; choose a new project ID");
    }
    if (!project || project.deleting)
      throw new PlatformError(409, "Project deletion is in progress; choose a new project ID");
    const [result] = await this.projects([id]);
    if (!result)
      throw new PlatformError(409, "Project was deleted during creation; choose a new project ID");
    return { project: result, created };
  }
  async projects(allowed?: string[]) {
    if (allowed?.length === 0) return [];
    const rows = await this.db
      .collection("vg_projects")
      .aggregate([
        { $match: allowed ? { id: { $in: allowed } } : {} },
        {
          $lookup: {
            from: "vg_runs",
            localField: "id",
            foreignField: "projectId",
            pipeline: [{ $count: "count" }],
            as: "counts",
          },
        },
        { $sort: { name: 1, id: 1 } },
      ])
      .toArray();
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      createdAt: row.createdAt as string,
      runCount: Number(row.counts[0]?.count ?? 0),
    }));
  }
  async getRun(id: string): Promise<RunDetail> {
    const run = await this.db.collection("vg_runs").findOne({ id });
    if (!run) throw new PlatformError(404, "Run not found");
    const {
      searchText: _search,
      artifactRef: _reference,
      ...detail
    } = clean<RunDetail & { searchText: string; artifactRef?: string }>(run);
    // Early F02 builds used the driver's default undefined-to-null encoding for metadata.
    for (const key of ["branch", "commit", "pullRequest", "deployment"] as const)
      if (detail.metadata[key] === null) delete detail.metadata[key];
    return detail;
  }
  async insertRun(run: Omit<RunDetail, "id">, preserveId?: string) {
    if (
      !(await this.db
        .collection("vg_projects")
        .findOne({ id: run.projectId, deleting: { $ne: true } })) ||
      (await this.db.collection("vg_project_tombstones").findOne({ id: run.projectId }))
    )
      throw new PlatformError(404, "Project not found or being deleted");
    // Leave headroom below MongoDB's BSON document limit for indexes and future envelope fields.
    if (Buffer.byteLength(JSON.stringify(run)) > 12 * 1024 * 1024)
      throw new PlatformError(
        413,
        "MongoDB run envelope exceeds the 12 MiB limit; split this execution into smaller complete runs",
      );
    const document: RunDetail = { ...run, id: preserveId ?? randomUUID() };
    const searchText = [
      run.engineRunId,
      run.metadata.branch,
      run.metadata.commit,
      run.metadata.deployment,
      ...run.manifest.jobs.flatMap((job) => [job.route, job.name, job.viewport]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const artifactRef = randomUUID();
    let published = false;
    try {
      // Atomic per-object pins prevent cleanup from racing publication, including on standalone MongoDB.
      for (const hash of new Set(run.artifacts.map((item) => item.hash))) {
        const object = await this.db
          .collection<MongoObject>("vg_objects")
          .findOneAndUpdate(
            { hash },
            { $addToSet: { runRefs: artifactRef } },
            { returnDocument: "after" },
          );
        if (!object)
          throw new PlatformError(
            409,
            "Evidence was removed during publication; upload or import the run again",
          );
        await new MongoArtifactStore(this.db).get(hash);
      }
      await this.db.collection("vg_runs").insertOne({ ...document, searchText, artifactRef });
      published = true;
      if (
        !(await this.db
          .collection("vg_projects")
          .findOne({ id: run.projectId, deleting: { $ne: true } })) ||
        (await this.db.collection("vg_project_tombstones").findOne({ id: run.projectId }))
      ) {
        await this.db.collection("vg_runs").deleteOne({ id: document.id, artifactRef });
        published = false;
        throw new PlatformError(409, "Project was deleted during publication");
      }
      return { run: document, duplicate: false };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
      const existing = await this.db
        .collection("vg_runs")
        .findOne({ projectId: run.projectId, engineRunId: run.engineRunId });
      if (!existing || existing.digest !== run.digest)
        throw new PlatformError(
          409,
          "This engine run ID already exists with different evidence or metadata; original history is immutable",
        );
      return { run: await this.getRun(existing.id), duplicate: true };
    } finally {
      if (!published)
        await this.db
          .collection<MongoObject>("vg_objects")
          .updateMany({ runRefs: artifactRef }, { $pull: { runRefs: artifactRef } });
    }
  }

  private async queueCleanup(hashes: Iterable<string>) {
    for (const hash of new Set(hashes)) {
      try {
        await this.db
          .collection("vg_state")
          .updateOne(
            { namespace: "artifact-cleanup", id: hash },
            {
              $setOnInsert: {
                namespace: "artifact-cleanup",
                id: hash,
                value: { hash },
                expiresAt: null,
              },
              $inc: { version: 1 },
            },
            { upsert: true },
          );
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
          throw error;
      }
    }
  }

  private async removeAccessAndUploads(project?: string, runId?: string) {
    if (project)
      await this.db
        .collection("vg_state")
        .deleteMany({ namespace: { $in: ["memberships", "tokens"] }, "value.projectId": project });
    const uploads = this.db
      .collection("vg_state")
      .find({
        namespace: "uploads",
        ...(project ? { "value.projectId": project } : { "value.result.id": runId }),
      });
    for await (const upload of uploads) {
      const prefix = { $regex: `^${regex(upload.id)}:` };
      const files = await this.db
        .collection("vg_state")
        .find({ namespace: "upload-files", id: prefix })
        .project({ "value.hash": 1 })
        .toArray();
      await this.queueCleanup(files.map((file) => file.value.hash as string));
      await this.db
        .collection("vg_state")
        .deleteMany({ namespace: { $in: ["upload-files", "upload-chunks"] }, id: prefix });
      await this.db.collection("vg_state").deleteOne({ namespace: "uploads", id: upload.id });
    }
  }

  private async cleanup(runs: number): Promise<DeletionResult> {
    let artifactsDeleted = 0,
      cleanupPending = false;
    try {
      const candidates = await this.db
        .collection("vg_state")
        .find({ namespace: "artifact-cleanup" })
        .limit(1000)
        .toArray();
      for (const candidate of candidates) {
        const hash = candidate.id as string;
        // Older runs predate per-object pins; keep their objects too.
        if (await this.db.collection("vg_runs").findOne({ "artifacts.hash": hash })) {
          await this.db
            .collection("vg_state")
            .deleteOne({ _id: candidate._id, version: candidate.version });
          continue;
        }
        if (
          await this.db
            .collection("vg_state")
            .findOne({
              namespace: "upload-files",
              "value.hash": hash,
              $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date().toISOString() } }],
            })
        ) {
          cleanupPending = true;
          continue;
        }
        const current = await this.db.collection<MongoObject>("vg_objects").findOne({ hash });
        if (current) {
          const id = `${hash}:${current.generation ?? "legacy"}`;
          try {
            await this.db
              .collection("vg_state")
              .updateOne(
                { namespace: "artifact-generations", id },
                {
                  $setOnInsert: {
                    namespace: "artifact-generations",
                    id,
                    value: { hash, generation: current.generation ?? null },
                    version: 1,
                    expiresAt: null,
                  },
                },
                { upsert: true },
              );
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
              throw error;
          }
        }
        const object =
          current &&
          (await this.db
            .collection<MongoObject>("vg_objects")
            .findOneAndDelete({
              hash,
              generation: current.generation ?? { $exists: false },
              $or: [{ runRefs: { $exists: false } }, { runRefs: { $size: 0 } }],
            }));
        if (object) {
          // Generation-scoped chunks allow a concurrent re-upload to create a new copy safely.
          await this.db
            .collection("vg_object_chunks")
            .deleteMany({ hash, generation: object.generation ?? { $exists: false } });
          artifactsDeleted++;
        } else if (await this.db.collection<MongoObject>("vg_objects").findOne({ hash })) {
          cleanupPending = true;
          continue;
        }
        await this.db
          .collection("vg_state")
          .deleteOne({ _id: candidate._id, version: candidate.version });
      }
      // Persist chunk cleanup separately before removing object metadata, so an interrupted
      // deletion can safely finish later without touching a newer upload of the same hash.
      for await (const task of this.db
        .collection("vg_state")
        .find({ namespace: "artifact-generations" })
        .limit(1000)) {
        const { hash, generation } = task.value;
        const current = await this.db.collection<MongoObject>("vg_objects").findOne({ hash });
        if (current && (current.generation ?? null) === generation) {
          cleanupPending = true;
          continue;
        }
        await this.db
          .collection("vg_object_chunks")
          .deleteMany({ hash, generation: generation ?? { $exists: false } });
        await this.db.collection("vg_state").deleteOne({ _id: task._id });
      }
      if (
        await this.db
          .collection("vg_state")
          .findOne({ namespace: { $in: ["artifact-cleanup", "artifact-generations"] } })
      )
        cleanupPending = true;
    } catch (error) {
      console.error("Evidence deletion completed; artifact cleanup remains queued", error);
      cleanupPending = true;
    }
    return { runs, artifactsDeleted, cleanupPending };
  }

  async deleteRun(id: string, expectedProject?: string): Promise<DeletionResult> {
    const run = await this.db
      .collection("vg_runs")
      .findOne({ id, ...(expectedProject ? { projectId: expectedProject } : {}) });
    if (!run) throw new PlatformError(404, "Run not found");
    await this.queueCleanup((run.artifacts as RunDetail["artifacts"]).map((item) => item.hash));
    const removed = await this.db.collection("vg_runs").deleteOne({ _id: run._id });
    const reference = run.artifactRef ?? id;
    await this.db
      .collection<MongoObject>("vg_objects")
      .updateMany({ runRefs: reference }, { $pull: { runRefs: reference } });
    await this.removeAccessAndUploads(undefined, id);
    return this.cleanup(removed.deletedCount);
  }

  async deleteProject(id: string, expectedRuns: number): Promise<DeletionResult> {
    if (!(await this.db.collection("vg_projects").findOne({ id })))
      throw new PlatformError(404, "Project not found");
    await this.db.collection("vg_projects").updateOne({ id }, { $set: { deleting: true } });
    const rows = await this.db
      .collection("vg_runs")
      .find({ projectId: id })
      .project({ id: 1, artifacts: 1, artifactRef: 1 })
      .toArray();
    if (rows.length !== expectedRuns) {
      await this.db.collection("vg_projects").updateOne({ id }, { $unset: { deleting: "" } });
      throw new PlatformError(409, "Project run count changed; refresh and confirm deletion again");
    }
    try {
      await this.db
        .collection("vg_project_tombstones")
        .updateOne({ id }, { $setOnInsert: { id } }, { upsert: true });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
    }
    await this.queueCleanup(
      rows.flatMap((run) => (run.artifacts as RunDetail["artifacts"]).map((item) => item.hash)),
    );
    for (const run of rows) {
      await this.db.collection("vg_runs").deleteOne({ _id: run._id });
      const reference = run.artifactRef ?? run.id;
      await this.db
        .collection<MongoObject>("vg_objects")
        .updateMany({ runRefs: reference }, { $pull: { runRefs: reference } });
    }
    await this.removeAccessAndUploads(id);
    await this.db.collection("vg_projects").deleteOne({ id });
    return this.cleanup(rows.length);
  }
  async runs(filters: RunFilters, allowed?: string[]): Promise<RunPage> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25)),
      offset = Math.max(0, filters.offset ?? 0);
    if (allowed?.length === 0 || (allowed && filters.project && !allowed.includes(filters.project)))
      return { runs: [], total: 0, limit, offset };
    const match: Document = {};
    if (allowed) match.projectId = { $in: allowed };
    for (const [key, field] of Object.entries({
      project: "projectId",
      status: "status",
      environment: "metadata.environment",
      branch: "metadata.branch",
      commit: "metadata.commit",
      pullRequest: "metadata.pullRequest",
      deployment: "metadata.deployment",
    })) {
      const value = filters[key as keyof RunFilters];
      if (value !== undefined && value !== "") match[field] = value;
    }
    if (filters.q) match.searchText = { $regex: regex(filters.q.toLowerCase()) };
    if (filters.from || filters.to)
      match.startedAt = {
        ...(filters.from ? { $gte: filters.from } : {}),
        ...(filters.to ? { $lte: filters.to } : {}),
      };
    const [result] = await this.db
      .collection("vg_runs")
      .aggregate([
        { $match: match },
        { $sort: { startedAt: -1, id: -1 } },
        {
          $facet: {
            counts: [{ $count: "count" }],
            runs: [
              { $skip: offset },
              { $limit: limit },
              {
                $project: {
                  _id: 0,
                  manifest: 0,
                  artifacts: 0,
                  envelopeVersion: 0,
                  searchText: 0,
                  artifactRef: 0,
                },
              },
            ],
          },
        },
      ])
      .toArray();
    return { runs: result?.runs ?? [], total: result?.counts[0]?.count ?? 0, limit, offset };
  }
}

type MongoState = {
  namespace: string;
  id: string;
  value: unknown;
  version: number;
  expiresAt: string | null;
  expiresOn?: Date | null;
};
export class MongoStateStore implements StateStore {
  private collection: Collection<MongoState>;
  constructor(db: Db) {
    this.collection = db.collection<MongoState>("vg_state");
  }
  private live() {
    return { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date().toISOString() } }] };
  }
  async get<T>(namespace: string, id: string): Promise<StateRecord<T> | undefined> {
    const row = await this.collection.findOne({ namespace, id, ...this.live() });
    return row
      ? { id, value: row.value as T, version: row.version, expiresAt: row.expiresAt ?? undefined }
      : undefined;
  }
  async create<T>(namespace: string, id: string, value: T, expiresAt?: string) {
    await this.collection.deleteOne({
      namespace,
      id,
      expiresAt: { $ne: null, $lte: new Date().toISOString() },
    });
    try {
      await this.collection.insertOne({
        namespace,
        id,
        value,
        version: 1,
        expiresAt: expiresAt ?? null,
        expiresOn: expiresAt ? new Date(expiresAt) : null,
      });
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000)
        return false;
      throw error;
    }
  }
  async replace<T>(namespace: string, item: StateRecord<T>) {
    return (
      (
        await this.collection.updateOne(
          { namespace, id: item.id, version: item.version, ...this.live() },
          {
            $set: {
              value: item.value,
              expiresAt: item.expiresAt ?? null,
              expiresOn: item.expiresAt ? new Date(item.expiresAt) : null,
            },
            $inc: { version: 1 },
          },
        )
      ).modifiedCount === 1
    );
  }
  async remove(namespace: string, id: string, version?: number) {
    return (
      (
        await this.collection.deleteOne({
          namespace,
          id,
          ...(version === undefined ? {} : { version }),
        })
      ).deletedCount === 1
    );
  }
  async list<T>(namespace: string, prefix = "", limit = 1000): Promise<StateRecord<T>[]> {
    const rows = await this.collection
      .find({ namespace, id: { $regex: `^${regex(prefix)}` }, ...this.live() })
      .sort({ id: 1 })
      .limit(limit)
      .toArray();
    return rows.map((row) => ({
      id: row.id,
      value: row.value as T,
      version: row.version,
      expiresAt: row.expiresAt ?? undefined,
    }));
  }
  async pruneExpired(limit = 250) {
    const rows = await this.collection
      .find({ expiresAt: { $ne: null, $lte: new Date().toISOString() } })
      .limit(limit)
      .toArray();
    if (!rows.length) return 0;
    return (
      await this.collection.deleteMany({
        _id: { $in: rows.map((row) => row._id) },
        expiresAt: { $ne: null, $lte: new Date().toISOString() },
      })
    ).deletedCount;
  }
}

export class MongoArtifactStore implements ArtifactStore {
  constructor(private db: Db) {}
  async put(bytes: Uint8Array) {
    const hash = sha256(bytes),
      chunks = Math.max(1, Math.ceil(bytes.length / OBJECT_CHUNK_BYTES)),
      generation = randomUUID();
    if (await this.db.collection<MongoObject>("vg_objects").findOne({ hash })) return hash;
    for (let index = 0; index < chunks; index++) {
      const key = `${hash}:${generation}:${index}`;
      try {
        await this.db
          .collection("vg_object_chunks")
          .updateOne(
            { key },
            {
              $setOnInsert: {
                key,
                hash,
                generation,
                chunk: index,
                data: Buffer.from(
                  bytes.subarray(index * OBJECT_CHUNK_BYTES, (index + 1) * OBJECT_CHUNK_BYTES),
                ).toString("base64"),
              },
            },
            { upsert: true },
          );
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
          throw error;
      }
    }
    try {
      await this.db
        .collection<MongoObject>("vg_objects")
        .updateOne(
          { hash },
          { $setOnInsert: { hash, generation, size: bytes.length, chunks, runRefs: [] } },
          { upsert: true },
        );
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
    }
    const winner = await this.db.collection<MongoObject>("vg_objects").findOne({ hash });
    if (winner?.generation !== generation)
      await this.db.collection("vg_object_chunks").deleteMany({ hash, generation });
    return hash;
  }
  async get(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
    const meta = await this.db.collection<MongoObject>("vg_objects").findOne({ hash });
    if (!meta) throw new Error("Artifact object not found");
    const rows = await this.db
      .collection("vg_object_chunks")
      .find({ hash, generation: meta.generation ?? { $exists: false } })
      .sort({ chunk: 1 })
      .toArray();
    const data = Buffer.concat(rows.map((row) => Buffer.from(row.data, "base64")));
    if (rows.length !== meta.chunks || data.length !== meta.size || sha256(data) !== hash)
      throw new Error("Stored artifact checksum mismatch");
    return data;
  }
  async getChunk(hash: string, index: number) {
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(index) || index < 0)
      throw new Error("Invalid artifact chunk");
    const meta = await this.db.collection<MongoObject>("vg_objects").findOne({ hash });
    const row = meta
      ? await this.db
          .collection("vg_object_chunks")
          .findOne({ hash, chunk: index, generation: meta.generation ?? { $exists: false } })
      : undefined;
    if (!meta || !row || index >= meta.chunks) throw new Error("Artifact object not found");
    const bytes = Buffer.from(row.data, "base64");
    if (bytes.length !== Math.min(OBJECT_CHUNK_BYTES, meta.size - index * OBJECT_CHUNK_BYTES))
      throw new Error("Stored artifact chunk length mismatch");
    return bytes;
  }
}

export async function openMongo(url: string) {
  const client = new MongoClient(url, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10_000,
    ignoreUndefined: true,
  });
  try {
    await client.connect();
    const name = decodeURIComponent(url.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1] ?? "");
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name))
      throw new Error("MongoDB URL must include a database name");
    const db = client.db(name);
    await Promise.all([
      db.collection("vg_projects").createIndex({ id: 1 }, { unique: true }),
      db.collection("vg_project_tombstones").createIndex({ id: 1 }, { unique: true }),
      db.collection("vg_runs").createIndex({ id: 1 }, { unique: true }),
      db.collection("vg_runs").createIndex({ projectId: 1, engineRunId: 1 }, { unique: true }),
      db.collection("vg_runs").createIndex({ projectId: 1, startedAt: -1, id: -1 }),
      db.collection("vg_state").createIndex({ namespace: 1, id: 1 }, { unique: true }),
      db.collection("vg_state").createIndex({ expiresOn: 1 }, { expireAfterSeconds: 0 }),
      db.collection("vg_objects").createIndex({ hash: 1 }, { unique: true }),
      db.collection("vg_object_chunks").createIndex({ key: 1 }, { unique: true }),
    ]);
    return {
      repository: new MongoRepository(db),
      state: new MongoStateStore(db),
      store: new MongoArtifactStore(db),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
