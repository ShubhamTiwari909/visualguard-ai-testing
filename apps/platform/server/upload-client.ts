import { realpath } from "node:fs/promises";
import { artifactPath, parseManifest, parseMetadata } from "./validation.js";
import {
  MAX_ARTIFACT_BYTES,
  MAX_MANIFEST_BYTES,
  canonical,
  evidenceType,
  readRunFile,
  requiredArtifacts,
} from "./ingest.js";
import { sha256 } from "./artifacts.js";
import type { RunMetadata } from "../shared/contracts.js";

export interface PublishOptions {
  server: string;
  project: string;
  runDir: string;
  token?: string;
  metadata: RunMetadata;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** Small idempotent requests survive serverless restarts and can be resumed by repeating the command. */
export async function uploadRun(
  options: PublishOptions,
): Promise<{ id: string; status: string; duplicate: boolean; url: string }> {
  const server = new URL(options.server);
  if (
    server.pathname !== "/" ||
    server.search ||
    server.hash ||
    server.username ||
    server.password ||
    !["http:", "https:"].includes(server.protocol)
  )
    throw new Error("Dashboard URL must be an HTTP(S) origin");
  if (
    server.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)
  )
    throw new Error("Remote uploads require HTTPS");
  const root = await realpath(options.runDir),
    manifestBytes = await readRunFile(root, "manifest.json", MAX_MANIFEST_BYTES);
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  const metadata = parseMetadata({
    ...options.metadata,
    commit: options.metadata.commit ?? manifest.provenance?.sourceRevision,
  });
  let csrf = "";
  if (!options.token) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(server.hostname))
      throw new Error("Set VISUALGUARD_UPLOAD_TOKEN to a project upload credential");
    const sessionResponse = await fetch(new URL("/api/session", server), {
      signal: options.signal,
    });
    const session = (await sessionResponse.json()) as { access: string; token?: string };
    if (session.access !== "local" || !session.token)
      throw new Error("Set VISUALGUARD_UPLOAD_TOKEN for a dashboard requiring login");
    csrf = session.token;
  }
  const request = async <T>(
    path: string,
    method: string,
    data?: unknown,
    binary = false,
  ): Promise<T> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      options.signal?.throwIfAborted();
      let response: Response;
      try {
        response = await fetch(new URL(path, server), {
          method,
          redirect: "error",
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
            : AbortSignal.timeout(60_000),
          headers: {
            "Content-Type": binary ? "application/octet-stream" : "application/json",
            ...(options.token
              ? { Authorization: `Bearer ${options.token}` }
              : { "x-visualguard-platform-token": csrf }),
          },
          body:
            data === undefined
              ? undefined
              : binary
                ? (data as Uint8Array<ArrayBuffer>)
                : JSON.stringify(data),
        });
      } catch (error) {
        if (attempt === 3 || options.signal?.aborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      let value: T & { error?: string };
      try {
        value = (await response.json()) as T & { error?: string };
      } catch {
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3)
          throw new Error(`Dashboard returned an invalid response (${response.status})`);
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      if (response.ok) return value;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3)
        throw new Error(value.error ?? `Upload failed (${response.status})`);
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
    throw new Error("Upload failed after retries");
  };
  const manifestHash = sha256(manifestBytes);
  const paths = ["manifest.json", ...requiredArtifacts(manifest)];
  const descriptors = [];
  for (const path of paths) {
    const bytes =
      path === "manifest.json" ? manifestBytes : await readRunFile(root, path, MAX_ARTIFACT_BYTES);
    descriptors.push({
      path,
      hash: sha256(bytes),
      size: bytes.length,
      mediaType: path === "manifest.json" ? "application/json" : evidenceType(path, bytes),
    });
  }
  const session = await request<{
    id: string;
    chunkBytes: number;
    result?: { id: string; status: string; duplicate: boolean };
  }>(`/api/projects/${encodeURIComponent(options.project)}/uploads`, "POST", {
    engineRunId: manifest.id,
    manifestHash,
    manifestSize: manifestBytes.length,
    metadata,
    idempotencyKey: sha256(canonical({ manifestHash, metadata, descriptors })),
  });
  if (session.result)
    return {
      ...session.result,
      duplicate: true,
      url: new URL(`/runs/${session.result.id}`, server).href,
    };
  if (session.chunkBytes !== 1024 * 1024) throw new Error("Unsupported upload chunk size");
  for (const descriptor of descriptors) {
    const { path } = descriptor;
    artifactPath(path);
    const bytes =
      path === "manifest.json" ? manifestBytes : await readRunFile(root, path, MAX_ARTIFACT_BYTES);
    if (sha256(bytes) !== descriptor.hash || bytes.length !== descriptor.size)
      throw new Error("Evidence changed while preparing upload; regenerate the run and retry");
    const file = await request<{ id: string; complete: boolean }>(
      `/api/uploads/${session.id}/files`,
      "POST",
      descriptor,
    );
    if (!file.complete) {
      for (let offset = 0, index = 0; offset < bytes.length; offset += session.chunkBytes, index++)
        await request(
          `/api/uploads/${session.id}/files/${file.id}/chunks/${index}`,
          "PUT",
          bytes.subarray(offset, offset + session.chunkBytes),
          true,
        );
      await request(`/api/uploads/${session.id}/files/${file.id}/complete`, "POST");
    }
    options.onProgress?.(`${path}: uploaded`);
  }
  const result = await request<{ id: string; status: string; duplicate: boolean }>(
    `/api/uploads/${session.id}/finalize`,
    "POST",
  );
  return { ...result, url: new URL(`/runs/${result.id}`, server).href };
}
