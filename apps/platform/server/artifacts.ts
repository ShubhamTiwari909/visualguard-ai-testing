/** Private content-addressed object storage. Only indexed run artifacts are served by HTTP. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "./database.js";
import { artifactKey, type ObjectBucket } from "./object-storage.js";

export const OBJECT_CHUNK_BYTES = 1024 * 1024;

export const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");

export interface ArtifactStore {
  put(data: Uint8Array): Promise<string>;
  get(hash: string): Promise<Buffer>;
  getChunk?(hash: string, index: number): Promise<Buffer>;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private root: string) {}

  private path(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
    return join(this.root, hash.slice(0, 2), hash);
  }

  async put(data: Uint8Array): Promise<string> {
    const hash = sha256(data);
    const path = this.path(hash);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      // Identical hashes have identical content; concurrent writes cannot change evidence.
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return hash;
  }

  async get(hash: string): Promise<Buffer> {
    const data = await readFile(this.path(hash));
    if (sha256(data) !== hash) throw new Error("Stored artifact checksum mismatch");
    return data;
  }

  async remove(hash: string): Promise<void> {
    await rm(this.path(hash), { force: true });
  }
}

/** Bytes the index lists in external object storage are gone from the bucket. */
export class MissingArtifactError extends Error {
  constructor(bucket: ObjectBucket) {
    super(`Stored artifact is missing from ${bucket.description}`);
    this.name = "MissingArtifactError";
  }
}

const unconfigured = () =>
  new Error(
    "Artifact is in external object storage; set VISUALGUARD_ARTIFACT_STORAGE_URL to read it",
  );

/**
 * Read an object kept in external storage and verify it, so a bucket can never serve changed
 * evidence. `chunks = 0` in the object index marks these objects.
 */
export async function readExternal(
  bucket: ObjectBucket | undefined,
  key: string,
  hash: string,
  size: number,
): Promise<Buffer> {
  if (!bucket) throw unconfigured();
  const data = await bucket.get(key);
  if (!data) throw new MissingArtifactError(bucket);
  if (data.length !== size || sha256(data) !== hash)
    throw new Error("Stored artifact checksum mismatch");
  return data;
}

/**
 * Read one OBJECT_CHUNK_BYTES slice of an external object with a ranged request, so chunked
 * downloads do not fetch the whole object per chunk. Like database chunks, a slice is checked
 * for length; the whole-object digest is checked by full reads.
 */
export async function readExternalChunk(
  bucket: ObjectBucket | undefined,
  key: string,
  size: number,
  index: number,
): Promise<Buffer> {
  if (index >= Math.max(1, Math.ceil(size / OBJECT_CHUNK_BYTES)))
    throw new Error("Artifact object not found");
  if (!bucket) throw unconfigured();
  const length = Math.min(OBJECT_CHUNK_BYTES, size - index * OBJECT_CHUNK_BYTES);
  if (length === 0) return Buffer.alloc(0);
  const data = await bucket.getRange(key, index * OBJECT_CHUNK_BYTES, length);
  if (!data) throw new MissingArtifactError(bucket);
  if (data.length !== length) throw new Error("Stored artifact chunk length mismatch");
  return data;
}

/**
 * Objects indexed in vg_objects. Without a bucket, bytes are stored as database chunks, which
 * keeps a database dump self-contained and survives ephemeral hosts. With one, new bytes go to
 * the bucket (chunks = 0) while existing database objects stay readable.
 */
export class SqlArtifactStore implements ArtifactStore {
  constructor(
    private db: Database,
    private bucket?: ObjectBucket,
  ) {}
  async put(data: Uint8Array): Promise<string> {
    const hash = sha256(data);
    await this.db.transaction(async (sql) => {
      const [existing] = await sql.query<{ chunks: number }>(
        "SELECT chunks FROM vg_objects WHERE hash=?",
        [hash],
      );
      if (this.bucket) {
        const key = artifactKey(hash);
        // The transaction lock also covers cleanup, so a deletion cannot interleave. Re-upload
        // when the index outlived its bytes, e.g. after an interrupted cleanup.
        if (existing && (Number(existing.chunks) > 0 || (await this.bucket.exists(key)))) return;
        await this.bucket.put(key, data);
        await sql.query(
          "INSERT INTO vg_objects(hash, size, chunks) VALUES(?, ?, 0) ON CONFLICT(hash) DO NOTHING",
          [hash, data.length],
        );
        return;
      }
      if (existing) return;
      const chunks = Math.max(1, Math.ceil(data.length / OBJECT_CHUNK_BYTES));
      for (let index = 0; index < chunks; index++) {
        const part = Buffer.from(
          data.subarray(index * OBJECT_CHUNK_BYTES, (index + 1) * OBJECT_CHUNK_BYTES),
        );
        await sql.query(
          "INSERT INTO vg_object_chunks(hash, chunk, data) VALUES(?, ?, ?) ON CONFLICT(hash, chunk) DO NOTHING",
          [hash, index, part.toString("base64")],
        );
      }
      await sql.query(
        "INSERT INTO vg_objects(hash, size, chunks) VALUES(?, ?, ?) ON CONFLICT(hash) DO NOTHING",
        [hash, data.length, chunks],
      );
    });
    return hash;
  }
  async get(hash: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
    const [meta] = await this.db.query<{ size: number; chunks: number }>(
      "SELECT size, chunks FROM vg_objects WHERE hash=?",
      [hash],
    );
    if (!meta) throw new Error("Artifact object not found");
    if (Number(meta.chunks) === 0)
      return readExternal(this.bucket, artifactKey(hash), hash, Number(meta.size));
    const rows = await this.db.query<{ data: string }>(
      "SELECT data FROM vg_object_chunks WHERE hash=? ORDER BY chunk",
      [hash],
    );
    const data = Buffer.concat(rows.map((row) => Buffer.from(row.data, "base64")));
    if (rows.length !== meta.chunks || data.length !== meta.size || sha256(data) !== hash)
      throw new Error("Stored artifact checksum mismatch");
    return data;
  }
  async getChunk(hash: string, index: number): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(index) || index < 0)
      throw new Error("Invalid artifact chunk");
    const [meta] = await this.db.query<{ chunks: number; size: number }>(
      "SELECT chunks, size FROM vg_objects WHERE hash=?",
      [hash],
    );
    if (meta && Number(meta.chunks) === 0)
      return readExternalChunk(this.bucket, artifactKey(hash), Number(meta.size), index);
    const [row] = await this.db.query<{ data: string; size: number; chunks: number }>(
      "SELECT c.data, o.size, o.chunks FROM vg_object_chunks c JOIN vg_objects o ON o.hash=c.hash WHERE c.hash=? AND c.chunk=?",
      [hash, index],
    );
    if (!row || index >= row.chunks) throw new Error("Artifact object not found");
    const bytes = Buffer.from(row.data, "base64");
    if (bytes.length !== Math.min(OBJECT_CHUNK_BYTES, row.size - index * OBJECT_CHUNK_BYTES))
      throw new Error("Stored artifact chunk length mismatch");
    return bytes;
  }
}

/** Preserve pre-release F01 file artifacts while moving new writes into the database. */
export class FallbackArtifactStore implements ArtifactStore {
  constructor(
    private primary: ArtifactStore,
    private fallback: ArtifactStore,
  ) {}
  put(data: Uint8Array) {
    return this.primary.put(data);
  }
  async get(hash: string) {
    try {
      return await this.primary.get(hash);
    } catch (error) {
      // Never hide corrupted primary evidence by silently switching copies.
      if (error instanceof Error && error.message === "Artifact object not found")
        return this.fallback.get(hash);
      throw error;
    }
  }
  async getChunk(hash: string, index: number) {
    try {
      return this.primary.getChunk
        ? await this.primary.getChunk(hash, index)
        : (await this.primary.get(hash)).subarray(
            index * OBJECT_CHUNK_BYTES,
            (index + 1) * OBJECT_CHUNK_BYTES,
          );
    } catch (error) {
      if (error instanceof Error && error.message === "Artifact object not found")
        return (await this.fallback.get(hash)).subarray(
          index * OBJECT_CHUNK_BYTES,
          (index + 1) * OBJECT_CHUNK_BYTES,
        );
      throw error;
    }
  }
}
