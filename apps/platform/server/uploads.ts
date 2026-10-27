import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AuthService, Actor } from "./auth.js";
import type { ArtifactStore } from "./artifacts.js";
import { MissingArtifactError, sha256 } from "./artifacts.js";
import type { PlatformRepository, StateStore } from "./storage-contracts.js";
import type { ArtifactDescriptor, RunMetadata } from "../shared/contracts.js";
import { PlatformError } from "./errors.js";
import { artifactPath, parseManifest, parseMetadata } from "./validation.js";
import {
  MAX_ARTIFACT_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_RUN_ARTIFACTS,
  MAX_RUN_BYTES,
  publishRun,
  requiredArtifacts,
} from "./ingest.js";
import { body, json, readBytes } from "./transport.js";

export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
interface UploadSession {
  projectId: string;
  owner: string;
  metadata: RunMetadata;
  manifestHash: string;
  manifestSize: number;
  engineRunId: string;
  result?: { id: string; duplicate: boolean; status: string };
}
interface FileState extends ArtifactDescriptor {
  complete: boolean;
}
const expiry = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const owner = (actor: Actor) => actor.credentialId ?? actor.id;

export class Uploads {
  constructor(
    private repository: PlatformRepository,
    private store: ArtifactStore,
    private state: StateStore,
    private auth: AuthService,
  ) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    actor: Actor,
  ): Promise<boolean> {
    const start = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/uploads$/);
    if (start && request.method === "POST") {
      const projectId = start[1]!;
      if (
        actor.credentialId
          ? actor.uploadProject !== projectId
          : !(await this.auth.hasRole(actor, projectId, "maintainer"))
      )
        throw new PlatformError(403, "Upload credential does not permit this project");
      if (!(await this.repository.projects([projectId])).length)
        throw new PlatformError(404, "Project not found");
      await this.state.pruneExpired();
      const input = z
        .object({
          idempotencyKey: hashSchema,
          manifestHash: hashSchema,
          manifestSize: z.number().int().positive().max(MAX_MANIFEST_BYTES),
          engineRunId: z.string().min(1).max(300),
          metadata: z.unknown(),
        })
        .parse(await body(request));
      const metadata = parseMetadata(input.metadata),
        id = sha256(`${projectId}:${owner(actor)}:${input.idempotencyKey}`);
      const value: UploadSession = {
        projectId,
        owner: owner(actor),
        metadata,
        manifestHash: input.manifestHash,
        manifestSize: input.manifestSize,
        engineRunId: input.engineRunId,
      };
      const created = await this.state.create("uploads", id, value, expiry());
      const existing = (await this.state.get<UploadSession>("uploads", id))!;
      if (
        !created &&
        (existing.value.manifestHash !== input.manifestHash ||
          JSON.stringify(existing.value.metadata) !== JSON.stringify(metadata) ||
          existing.value.engineRunId !== input.engineRunId)
      )
        throw new PlatformError(409, "Idempotency key is bound to another upload");
      json(response, 200, {
        id,
        chunkBytes: UPLOAD_CHUNK_BYTES,
        result: existing.value.result,
        expiresAt: existing.expiresAt,
      });
      return true;
    }
    const match = url.pathname.match(
      /^\/api\/uploads\/([a-f0-9]{64})(?:\/files(?:\/([a-f0-9]{64})(?:\/chunks\/(\d+)|\/(complete))?)?|\/(finalize))?$/,
    );
    if (!match) return false;
    const id = match[1]!,
      entry = await this.state.get<UploadSession>("uploads", id);
    if (!entry)
      throw new PlatformError(404, "Upload session missing or expired; start a new upload");
    const session = entry.value;
    if (!(await this.repository.projects([session.projectId])).length)
      throw new PlatformError(404, "Project not found; this upload is no longer available");
    if (
      session.owner !== owner(actor) ||
      (actor.credentialId
        ? actor.uploadProject !== session.projectId
        : !(await this.auth.hasRole(actor, session.projectId, "maintainer")))
    )
      throw new PlatformError(403, "Upload session belongs to another credential or project");
    if (request.method === "GET" && !match[2]) {
      json(response, 200, { id, result: session.result, expiresAt: entry.expiresAt });
      return true;
    }
    if (request.method === "POST" && match[5]) {
      if (session.result) {
        await this.repository.getRun(session.result.id);
        json(response, 200, { ...session.result, duplicate: true });
        return true;
      }
      const files = await this.state.list<FileState>(
        "upload-files",
        `${id}:`,
        MAX_RUN_ARTIFACTS + 2,
      );
      const manifest = files.find((row) => row.value.path === "manifest.json")?.value;
      if (
        !manifest?.complete ||
        manifest.hash !== session.manifestHash ||
        manifest.size !== session.manifestSize
      )
        throw new PlatformError(409, "Manifest is not completely uploaded");
      const manifestData = parseManifest(
        JSON.parse((await this.store.get(manifest.hash)).toString("utf8")),
      );
      if (manifestData.id !== session.engineRunId)
        throw new PlatformError(400, "Manifest run ID differs from the declared upload");
      const expected = requiredArtifacts(manifestData),
        artifacts: ArtifactDescriptor[] = [];
      for (const path of expected) {
        const file = files.find((row) => row.value.path === path)?.value;
        if (!file?.complete)
          throw new PlatformError(409, `Required artifact is not completely uploaded: ${path}`);
        const { complete: _complete, ...descriptor } = file;
        artifacts.push(descriptor);
      }
      const result = await publishRun(this.repository, this.store, {
        projectId: session.projectId,
        manifest: manifestData,
        metadata: session.metadata,
        artifacts,
        actorId: actor.id,
      });
      entry.value.result = {
        id: result.run.id,
        duplicate: result.duplicate,
        status: result.run.status,
      };
      await this.state.replace("uploads", entry);
      await this.auth.audit(actor, "run.uploaded", {
        projectId: session.projectId,
        runId: result.run.id,
        credentialId: actor.credentialId,
      });
      json(response, 200, entry.value.result);
      return true;
    }
    if (session.result) throw new PlatformError(409, "Upload is finalized and immutable");
    if (request.method === "POST" && url.pathname.endsWith("/files")) {
      const file = z
        .object({
          path: z.string(),
          hash: hashSchema,
          size: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
          mediaType: z.enum(["image/png", "application/json"]),
        })
        .parse(await body(request));
      artifactPath(file.path);
      if (
        file.path === "manifest.json" &&
        (file.hash !== session.manifestHash ||
          file.size !== session.manifestSize ||
          file.size > MAX_MANIFEST_BYTES)
      )
        throw new PlatformError(400, "Manifest descriptor mismatch");
      const fileId = sha256(file.path),
        key = `${id}:${fileId}`;
      const existing = await this.state.get<FileState>("upload-files", key);
      if (!existing) {
        const files = await this.state.list<FileState>(
          "upload-files",
          `${id}:`,
          MAX_RUN_ARTIFACTS + 2,
        );
        if (
          files.length >= MAX_RUN_ARTIFACTS + 1 ||
          files.reduce((sum, row) => sum + row.value.size, 0) + file.size >
            MAX_RUN_BYTES + MAX_MANIFEST_BYTES
        )
          throw new PlatformError(413, "Upload artifact budget exceeded");
        await this.state.create<FileState>(
          "upload-files",
          key,
          { ...file, complete: false },
          entry.expiresAt,
        );
      }
      const record = (await this.state.get<FileState>("upload-files", key))!;
      if (
        record.value.hash !== file.hash ||
        record.value.size !== file.size ||
        record.value.mediaType !== file.mediaType
      )
        throw new PlatformError(409, "File path is bound to different bytes");
      if (record.value.complete) {
        try {
          if (this.store.getChunk) await this.store.getChunk(record.value.hash, 0);
          else await this.store.get(record.value.hash);
        } catch (error) {
          const missing =
            (error instanceof Error && error.message === "Artifact object not found") ||
            error instanceof MissingArtifactError ||
            (error && typeof error === "object" && "code" in error && error.code === "ENOENT");
          if (!missing) throw error;
          // A deletion can reclaim a shared object just before a new upload registers it.
          // Let a repeated publish send those bytes again instead of trusting a stale flag.
          record.value.complete = false;
          if (!(await this.state.replace("upload-files", record)))
            throw new PlatformError(409, "Upload changed during recovery; retry publishing");
        }
      }
      json(response, 200, { id: fileId, complete: record.value.complete });
      return true;
    }
    const fileId = match[2];
    if (!fileId) throw new PlatformError(404, "Upload endpoint not found");
    const key = `${id}:${fileId}`,
      file = await this.state.get<FileState>("upload-files", key);
    if (!file) throw new PlatformError(404, "File descriptor not registered");
    if (request.method === "PUT" && match[3] !== undefined) {
      const index = Number(match[3]),
        count = Math.ceil(file.value.size / UPLOAD_CHUNK_BYTES);
      if (!Number.isSafeInteger(index) || index < 0 || index >= count)
        throw new PlatformError(400, "Chunk index is out of range");
      if (file.value.complete) {
        json(response, 200, { ok: true });
        return true;
      }
      const bytes = await readBytes(request, UPLOAD_CHUNK_BYTES),
        expectedSize = Math.min(UPLOAD_CHUNK_BYTES, file.value.size - index * UPLOAD_CHUNK_BYTES);
      if (bytes.length !== expectedSize)
        throw new PlatformError(400, "Chunk length does not match file descriptor");
      const chunkKey = `${key}:${index}`,
        hash = sha256(bytes);
      if (
        !(await this.state.create(
          "upload-chunks",
          chunkKey,
          { hash, data: bytes.toString("base64") },
          entry.expiresAt,
        ))
      ) {
        if (
          (await this.state.get<{ hash: string }>("upload-chunks", chunkKey))?.value.hash !== hash
        )
          throw new PlatformError(409, "Chunk already contains different bytes");
      }
      json(response, 200, { ok: true });
      return true;
    }
    if (request.method === "POST" && match[4]) {
      if (!file.value.complete) {
        const parts: Buffer[] = [],
          count = Math.ceil(file.value.size / UPLOAD_CHUNK_BYTES);
        for (let index = 0; index < count; index++) {
          const chunk = await this.state.get<{ hash: string; data: string }>(
            "upload-chunks",
            `${key}:${index}`,
          );
          if (!chunk) throw new PlatformError(409, `Missing chunk ${index}`);
          const bytes = Buffer.from(chunk.value.data, "base64");
          if (sha256(bytes) !== chunk.value.hash)
            throw new PlatformError(400, "Chunk checksum mismatch");
          parts.push(bytes);
        }
        const data = Buffer.concat(parts);
        if (data.length !== file.value.size || sha256(data) !== file.value.hash)
          throw new PlatformError(400, "Complete file checksum mismatch");
        await this.store.put(data);
        file.value.complete = true;
        if (!(await this.state.replace("upload-files", file))) {
          if (!(await this.state.get<FileState>("upload-files", key))?.value.complete)
            throw new PlatformError(409, "File changed during completion; retry");
        }
        for (let index = 0; index < count; index++)
          await this.state.remove("upload-chunks", `${key}:${index}`);
      }
      json(response, 200, { complete: true });
      return true;
    }
    throw new PlatformError(404, "Upload endpoint not found");
  }
}
