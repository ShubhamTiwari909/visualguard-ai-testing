import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { SqlArtifactStore, sha256 } from "../server/artifacts.js";
import { openPlatform } from "../server/config.js";
import { openDatabase, type Database } from "../server/database.js";
import {
  artifactKey,
  AzureBlobBucket,
  GcsBucket,
  MemoryBucket,
  openObjectBucket,
  S3Bucket,
  type ObjectBucket,
} from "../server/object-storage.js";
import { Repository } from "../server/repository.js";
import type { RunDetail } from "../shared/contracts.js";

const HASH = "a".repeat(64);

describe("VISUALGUARD_ARTIFACT_STORAGE_URL", () => {
  const open = (value?: string, env: NodeJS.ProcessEnv = {}) =>
    openObjectBucket({ ...env, VISUALGUARD_ARTIFACT_STORAGE_URL: value });

  it("keeps evidence in the database when unset", async () => {
    expect(await openObjectBucket({})).toBeUndefined();
    expect(await open("  ")).toBeUndefined();
  });

  it("opens each provider with a normalized prefix", async () => {
    expect((await open("s3://evidence/visualguard//runs/?region=eu-west-1"))!.description).toBe(
      "s3://evidence/visualguard/runs/",
    );
    expect(
      (await open("s3://evidence?endpoint=http://127.0.0.1:9000&forcePathStyle=true"))!.description,
    ).toBe("s3://evidence/");
    expect((await open("gs://evidence/team-a"))!.description).toBe("gs://evidence/team-a/");
    expect(
      (await open("azure://evidence/team-a", {
        AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
      }))!.description,
    ).toBe("azure://evidence/team-a/");
  });

  it("explains invalid settings without echoing credentials", async () => {
    await expect(open("evidence-bucket")).rejects.toThrow(/must be a URL/);
    await expect(open("https://evidence.example.com")).rejects.toThrow(/s3:\/\/, gs:\/\//);
    await expect(open("s3://key:secret@evidence")).rejects.toThrow(/must not contain credentials/);
    await expect(open("s3://key:secret@evidence")).rejects.not.toThrow(/secret/);
    await expect(open("s3://evidence/team%2F..%2Fother")).rejects.toThrow(/"\." or "\.\."/);
    // Plain dot segments are already resolved by the URL parser.
    expect((await open("s3://evidence/a/../other"))!.description).toBe("s3://evidence/other/");
    await expect(open("s3://evidence?bucket=x")).rejects.toThrow(/unknown option "bucket"/);
    await expect(open("s3://evidence?endpoint=ftp://x")).rejects.toThrow(/http\(s\) URL/);
    await expect(open("gs://evidence?project=x")).rejects.toThrow(/take no options/);
    await expect(open("azure://evidence")).rejects.toThrow(/AZURE_STORAGE_CONNECTION_STRING/);
    await expect(open("memory://evidence")).rejects.toThrow(/must start with s3:\/\//);
  });

  it("is checked before the dashboard opens its database", async () => {
    const root = await mkdtemp(join(tmpdir(), "vg-object-config-"));
    try {
      await expect(
        openPlatform({
          VISUALGUARD_PLATFORM_DATA_DIR: root,
          VISUALGUARD_ARTIFACT_STORAGE_URL: "ftp://evidence",
        }),
      ).rejects.toThrow(/must start with s3:\/\//);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names objects by digest and optional upload generation", () => {
    expect(artifactKey(HASH)).toBe(`objects/aa/${HASH}`);
    expect(artifactKey(HASH, "3f2c-11")).toBe(`objects/aa/${HASH}.3f2c-11`);
    expect(() => artifactKey("../x")).toThrow(/digest/);
    expect(() => artifactKey(HASH, "../x")).toThrow(/generation/);
  });
});

/**
 * Exercise one adapter through the ObjectBucket contract: prefixing, missing objects and
 * idempotent deletes.
 */
async function bucketContract(bucket: ObjectBucket, stored: Map<string, Buffer>) {
  const data = Buffer.from("evidence bytes");
  await bucket.put("objects/aa/one", data);
  expect([...stored.keys()]).toEqual(["team/objects/aa/one"]);
  expect((await bucket.get("objects/aa/one"))?.equals(data)).toBe(true);
  expect(await bucket.exists("objects/aa/one")).toBe(true);
  expect(await bucket.get("objects/aa/missing")).toBeUndefined();
  expect(await bucket.exists("objects/aa/missing")).toBe(false);
  await bucket.delete("objects/aa/one");
  await bucket.delete("objects/aa/one");
  expect(stored.size).toBe(0);
}

describe("provider adapters", () => {
  it("S3 sends the SDK commands with the bucket and prefixed key", async () => {
    const stored = new Map<string, Buffer>();
    const sent: string[] = [];
    const client = {
      async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
        const { Bucket, Key, Body } = command.input as {
          Bucket: string;
          Key: string;
          Body?: Buffer;
        };
        expect(Bucket).toBe("evidence");
        sent.push(command.constructor.name);
        const missing = Object.assign(new Error("missing"), {
          $metadata: { httpStatusCode: 404 },
        });
        switch (command.constructor.name) {
          case "PutObjectCommand":
            stored.set(Key, Buffer.from(Body!));
            return {};
          case "GetObjectCommand":
            if (!stored.has(Key)) throw Object.assign(missing, { name: "NoSuchKey" });
            return { Body: { transformToByteArray: async () => stored.get(Key)! } };
          case "HeadObjectCommand":
            if (!stored.has(Key)) throw Object.assign(missing, { name: "NotFound" });
            return {};
          default:
            stored.delete(Key);
            return {};
        }
      },
    };
    const commands = { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
    await bucketContract(new S3Bucket(client, commands, "evidence", "team/"), stored);
    expect(new Set(sent)).toEqual(
      new Set(["PutObjectCommand", "GetObjectCommand", "HeadObjectCommand", "DeleteObjectCommand"]),
    );
  });

  it("S3 reports provider failures other than a missing object", async () => {
    const denied = Object.assign(new Error("Access Denied"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    });
    const client = { send: async () => Promise.reject(denied) };
    const commands = { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
    const bucket = new S3Bucket(client, commands, "evidence");
    await expect(bucket.get("objects/aa/one")).rejects.toThrow("Access Denied");
    await expect(bucket.exists("objects/aa/one")).rejects.toThrow("Access Denied");
  });

  it("Google Cloud Storage uses single-request uploads and ignores missing deletes", async () => {
    const stored = new Map<string, Buffer>();
    const bucket = {
      file: (name: string) => ({
        async save(data: Buffer, options: { resumable: boolean }) {
          expect(options.resumable).toBe(false);
          stored.set(name, data);
        },
        async download(): Promise<[Buffer]> {
          if (!stored.has(name)) throw Object.assign(new Error("No such object"), { code: 404 });
          return [stored.get(name)!];
        },
        exists: async (): Promise<[boolean]> => [stored.has(name)],
        async delete(options: { ignoreNotFound: boolean }) {
          expect(options.ignoreNotFound).toBe(true);
          stored.delete(name);
        },
      }),
    };
    await bucketContract(new GcsBucket(bucket, "evidence", "team/"), stored);
  });

  it("Azure Blob Storage uses block blobs and deleteIfExists", async () => {
    const stored = new Map<string, Buffer>();
    const container = {
      getBlockBlobClient: (name: string) => ({
        async uploadData(data: Buffer) {
          stored.set(name, data);
        },
        async downloadToBuffer() {
          if (!stored.has(name))
            throw Object.assign(new Error("BlobNotFound"), { statusCode: 404 });
          return stored.get(name)!;
        },
        exists: async () => stored.has(name),
        async deleteIfExists() {
          stored.delete(name);
        },
      }),
    };
    await bucketContract(new AzureBlobBucket(container, "evidence", "team/"), stored);
  });
});

describe("SQL evidence with object storage", () => {
  let root: string, db: Database;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-object-storage-"));
    db = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
  });
  afterEach(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Publish a minimal run that references one object, as an upload would after storing it.
   */
  const publish = async (repository: Repository, hash: string, size: number) => {
    const project = `objects-${randomUUID().slice(0, 8)}`;
    await repository.createProject(project, "Objects");
    const manifest = {
      schemaVersion: 1,
      id: randomUUID(),
      number: 1,
      startedAt: "2026-10-27T10:00:00.000Z",
      durationMs: 0,
      mode: "compare",
      tool: { version: "3.5.0", node: process.versions.node },
      config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
      summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 },
      jobs: [],
    } as RunDetail["manifest"];
    return repository.insertRun({
      envelopeVersion: 1,
      projectId: project,
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
      metadata: { environment: "objects" },
      digest: randomBytes(32).toString("hex"),
      jobCount: 0,
      manifest,
      artifacts: [{ path: "a.png", hash, size, mediaType: "image/png" }],
    });
  };

  it("keeps database evidence readable after a bucket is added and stores new evidence there", async () => {
    const before = randomBytes(2048);
    const old = await new SqlArtifactStore(db).put(before);
    const bucket = new MemoryBucket();
    const store = new SqlArtifactStore(db, bucket);
    expect((await store.get(old)).equals(before)).toBe(true);
    // Re-uploading content the database already holds does not copy it.
    await store.put(before);
    expect(bucket.objects.size).toBe(0);

    const after = randomBytes(3 * 1024 * 1024 + 5);
    const hash = await store.put(after);
    expect([...bucket.objects.keys()]).toEqual([artifactKey(hash)]);
    expect(await db.query("SELECT size, chunks FROM vg_objects WHERE hash=?", [hash])).toEqual([
      { size: after.length, chunks: 0 },
    ]);
    expect(await db.query("SELECT chunk FROM vg_object_chunks WHERE hash=?", [hash])).toEqual([]);
    expect((await store.get(hash)).equals(after)).toBe(true);
    expect((await store.getChunk!(hash, 3)).equals(after.subarray(3 * 1024 * 1024))).toBe(true);
    await expect(store.getChunk!(hash, 4)).rejects.toThrow("not found");
  });

  it("refuses changed or missing bucket bytes and explains a removed setting", async () => {
    const bucket = new MemoryBucket();
    const bytes = randomBytes(512);
    const hash = await new SqlArtifactStore(db, bucket).put(bytes);
    const repository = new Repository(db, undefined, bucket);

    bucket.objects.set(artifactKey(hash), randomBytes(512));
    await expect(new SqlArtifactStore(db, bucket).get(hash)).rejects.toThrow(/checksum mismatch/);
    bucket.objects.delete(artifactKey(hash));
    await expect(new SqlArtifactStore(db, bucket).get(hash)).rejects.toThrow(
      "Stored artifact is missing from memory://test/",
    );
    await expect(publish(repository, hash, bytes.length)).rejects.toMatchObject({ status: 409 });

    await expect(new SqlArtifactStore(db).get(hash)).rejects.toThrow(
      /set VISUALGUARD_ARTIFACT_STORAGE_URL/,
    );
    await expect(publish(new Repository(db), hash, bytes.length)).rejects.toMatchObject({
      status: 503,
    });

    // Uploading the same content again restores the missing copy.
    expect(await new SqlArtifactStore(db, bucket).put(bytes)).toBe(hash);
    expect(sha256(bucket.objects.get(artifactKey(hash))!)).toBe(hash);
    expect((await publish(repository, hash, bytes.length)).duplicate).toBe(false);
  });

  it("does not delete the index when removing bucket bytes fails", async () => {
    const bucket = new MemoryBucket();
    const bytes = randomBytes(256);
    const hash = await new SqlArtifactStore(db, bucket).put(bytes);
    const repository = new Repository(db, undefined, bucket);
    const { run } = await publish(repository, hash, bytes.length);
    const remove = bucket.delete.bind(bucket);
    bucket.delete = async () => Promise.reject(new Error("bucket unavailable"));
    const failed = await repository.deleteRun(run.id);
    expect(failed).toMatchObject({ runs: 1, artifactsDeleted: 0, cleanupPending: true });
    expect((await new SqlArtifactStore(db, bucket).get(hash)).equals(bytes)).toBe(true);

    // The queued cleanup finishes on the next deletion once the bucket recovers.
    bucket.delete = remove;
    const other = await publish(
      repository,
      await new SqlArtifactStore(db, bucket).put(randomBytes(64)),
      64,
    );
    await repository.deleteRun(other.run.id);
    await expect(new SqlArtifactStore(db, bucket).get(hash)).rejects.toThrow("not found");
    expect(bucket.objects.has(artifactKey(hash))).toBe(false);
  });
});
