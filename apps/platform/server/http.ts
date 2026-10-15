import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArtifactStore } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import { Repository } from "./repository.js";
import { artifactPath } from "./validation.js";
import { RUN_STATUSES, type RunFilters, type RunStatus } from "../shared/contracts.js";

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function integer(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new PlatformError(400, "Invalid numeric filter");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new PlatformError(400, "Numeric filter is outside its allowed range");
  return parsed;
}

function filters(params: URLSearchParams): RunFilters {
  const result: RunFilters = { limit: integer(params.get("limit"), 25, 1, 100), offset: integer(params.get("offset"), 0, 0, 10_000_000) };
  for (const key of ["project", "q", "environment", "branch", "commit", "deployment"] as const) {
    const value = params.get(key);
    if (value) { if (value.length > 500) throw new PlatformError(400, "Filter is too long"); result[key] = value; }
  }
  const status = params.get("status");
  if (status && !RUN_STATUSES.includes(status as RunStatus)) throw new PlatformError(400, "Unknown run status");
  if (status) result.status = status as RunStatus;
  if (params.has("pr")) result.pullRequest = integer(params.get("pr"), 1, 1, 2_147_483_647);
  for (const key of ["from", "to"] as const) {
    const value = params.get(key);
    if (value) {
      if (!Number.isFinite(Date.parse(value))) throw new PlatformError(400, "Invalid date filter");
      const date = new Date(value);
      if (key === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
      result[key] = date.toISOString();
    }
  }
  if (result.from && result.to && result.from > result.to) throw new PlatformError(400, "Start date must precede end date");
  return result;
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new PlatformError(415, "Expected application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new PlatformError(413, "Request body too large");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PlatformError(400, "Invalid JSON body"); }
}

/** F01 is deliberately loopback-only. This token protects local mutations, not user identity. */
export function createApi(repository: Repository, store: ArtifactStore) {
  const token = randomBytes(24).toString("hex");
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    let url: URL;
    try { url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); }
    catch { json(response, 400, { error: "Invalid URL" }); return true; }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      json(response, 403, { error: "F01 only serves loopback hosts; organization access requires F02" });
      return true;
    }
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      if (request.headers.origin && request.headers.origin !== url.origin) throw new PlatformError(403, "Cross-origin API access is not allowed");
      if (request.method !== "GET" && request.method !== "HEAD") {
        const supplied = Buffer.from(String(request.headers["x-visualguard-platform-token"] ?? ""));
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new PlatformError(403, "Missing or invalid local action token");
      }
      if (request.method === "GET" && url.pathname === "/api/session") {
        json(response, 200, { token, access: "local", envelopeVersion: 1 }); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        json(response, 200, { projects: await repository.projects() }); return true;
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        const input = await body(request);
        if (!input || typeof input !== "object" || !("id" in input) || !("name" in input) || typeof input.id !== "string" || typeof input.name !== "string") throw new PlatformError(400, "Project id and name are required");
        json(response, 201, await repository.createProject(input.id, input.name)); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/runs") {
        json(response, 200, await repository.runs(filters(url.searchParams))); return true;
      }
      const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(.*))?$/);
      if (request.method === "GET" && match) {
        const run = await repository.getRun(match[1]!);
        if (!match[2]) { json(response, 200, run); return true; }
        if (match[2].startsWith("artifacts/")) {
          let path: string;
          try { path = artifactPath(decodeURIComponent(match[2].slice("artifacts/".length))); }
          catch { throw new PlatformError(400, "Invalid artifact path"); }
          const artifact = run.artifacts.find((item) => item.path === path);
          if (!artifact) throw new PlatformError(404, "Artifact is not part of this run");
          const data = await store.get(artifact.hash);
          response.writeHead(200, {
            "Content-Type": artifact.mediaType, "Content-Length": data.length,
            "Cache-Control": "private, max-age=3600, immutable", ETag: `"${artifact.hash}"`,
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          });
          response.end(data); return true;
        }
      }
      throw new PlatformError(404, "API endpoint not found");
    } catch (error) {
      if (!(error instanceof PlatformError)) console.error("Platform API request failed", error);
      json(response, error instanceof PlatformError ? error.status : 500, { error: error instanceof PlatformError ? error.message : "Unable to read platform evidence; check server logs" });
      return true;
    }
  };
}
