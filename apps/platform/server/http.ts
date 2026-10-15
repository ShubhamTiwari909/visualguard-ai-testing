import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArtifactStore } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { PlatformRepository, StateStore } from "./storage-contracts.js";
import { AuthService, MemoryStateStore, type ProjectRole } from "./auth.js";
import { z } from "zod";
import { artifactPath } from "./validation.js";
import { RUN_STATUSES, type RunFilters, type RunStatus } from "../shared/contracts.js";
import { body, json } from "./transport.js";
import { Uploads, UPLOAD_CHUNK_BYTES } from "./uploads.js";
import { sha256 } from "./artifacts.js";

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

export interface ApiOptions { state?: StateStore; env?: NodeJS.ProcessEnv }
export function createApi(repository: PlatformRepository, store: ArtifactStore, options: ApiOptions = {}) {
  const auth = new AuthService(options.state ?? new MemoryStateStore(), options.env ?? process.env);
  if (auth.mode === "login" && !options.state) throw new Error("Hosted access requires persistent authentication state");
  const uploads = new Uploads(repository, store, auth.state, auth);
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    let url: URL;
    try { url = auth.url(request); }
    catch (error) { json(response, error instanceof PlatformError ? error.status : 400, { error: error instanceof Error ? error.message : "Invalid URL" }); return true; }
    if (!url.pathname.startsWith("/api/")) return false;
    try {
      await auth.ready;
      const actor = await auth.actor(request);
      if (request.method === "GET" && url.pathname === "/api/session") {
        json(response, 200, { token: actor?.credentialId ? undefined : actor?.csrf, access: auth.mode, user: actor && !actor.credentialId ? { id: actor.id, name: actor.name, email: actor.email, admin: actor.admin } : null, oidc: Boolean(auth.env.VISUALGUARD_OIDC_ISSUER), envelopeVersion: 1 }); return true;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const input = z.object({ email: z.string().max(254), password: z.string().max(256) }).parse(await body(request));
        json(response, 200, await auth.login(input.email, input.password, response)); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/auth/login") { await auth.beginOidc(response); return true; }
      if (request.method === "GET" && url.pathname === "/api/auth/callback") { await auth.finishOidc(request, response, url); return true; }
      if (!actor) throw new PlatformError(401, "Sign in to access this dashboard");
      if (request.method !== "GET" && request.method !== "HEAD") auth.csrf(request, actor);
      if (await uploads.handle(request, response, url, actor)) return true;
      if (request.method === "POST" && url.pathname === "/api/auth/logout") { await auth.logout(actor, response); json(response, 200, { ok: true }); return true; }
      if (actor.credentialId) throw new PlatformError(403, "Upload credentials cannot browse or administer the dashboard");
      if (url.pathname === "/api/users") {
        if (!actor.admin) throw new PlatformError(403, "Administrator access required");
        if (request.method === "GET") { json(response, 200, { users: await auth.users() }); return true; }
        if (request.method === "POST") {
          const input = z.object({ email: z.string(), password: z.string(), name: z.string(), role: z.enum(["admin", "member"]).optional() }).parse(await body(request));
          const user = await auth.createUser(input); await auth.audit(actor, "user.created", { userId: user.id }); json(response, 201, user); return true;
        }
      }
      const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
      if (request.method === "PATCH" && userMatch) {
        const input = z.object({ disabled: z.boolean().optional(), role: z.enum(["admin", "member"]).optional(), password: z.string().optional() }).strict().parse(await body(request));
        json(response, 200, await auth.updateUser(actor, decodeURIComponent(userMatch[1]!), input)); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/audit") {
        if (!actor.admin) throw new PlatformError(403, "Administrator access required");
        json(response, 200, { events: (await auth.state.list("audit", "", 100)).map((row) => row.value) }); return true;
      }
      const access = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/(members|tokens)(?:\/([a-f0-9]{64}))?$/);
      if (access) {
        const project = access[1]!; await auth.requireRole(actor, project, "maintainer");
        if (!(await repository.projects([project])).length) throw new PlatformError(404, "Project not found");
        if (access[2] === "members") {
          if (request.method === "GET") { json(response, 200, { members: await auth.members(project) }); return true; }
          if (request.method === "POST") {
            const input = z.object({ userId: z.string(), role: z.enum(["viewer", "reviewer", "maintainer"]).nullable() }).parse(await body(request));
            await auth.assign(actor, project, input.userId, input.role as ProjectRole | null); json(response, 200, { ok: true }); return true;
          }
        } else {
          if (request.method === "GET") { json(response, 200, { tokens: await auth.tokens(project) }); return true; }
          if (request.method === "POST") {
            const input = z.object({ name: z.string(), days: z.number().int() }).parse(await body(request));
            json(response, 201, await auth.mintToken(actor, project, input.name, input.days)); return true;
          }
          if (request.method === "DELETE" && access[3]) { await auth.revokeToken(actor, project, access[3]); json(response, 200, { ok: true }); return true; }
        }
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        json(response, 200, { projects: await repository.projects(await auth.projectIds(actor)) }); return true;
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        if (!actor.admin) throw new PlatformError(403, "Administrator access required to create projects");
        const input = await body(request);
        if (!input || typeof input !== "object" || !("id" in input) || !("name" in input) || typeof input.id !== "string" || typeof input.name !== "string") throw new PlatformError(400, "Project id and name are required");
        const project = await repository.createProject(input.id, input.name); await auth.audit(actor, "project.created", { projectId: project.id }); json(response, 201, project); return true;
      }
      if (request.method === "GET" && url.pathname === "/api/runs") {
        json(response, 200, await repository.runs(filters(url.searchParams), await auth.projectIds(actor))); return true;
      }
      const match = url.pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(.*))?$/);
      if (request.method === "GET" && match) {
        const run = await repository.getRun(match[1]!);
        await auth.requireRole(actor, run.projectId);
        if (!match[2]) {
          const bytes = Buffer.from(JSON.stringify(run.manifest));
          json(response, 200, bytes.length > 2 * UPLOAD_CHUNK_BYTES ? { ...run, manifest: undefined, manifestTransfer: { size: bytes.length, hash: sha256(bytes), chunks: Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES) } } : run); return true;
        }
        if (match[2] === "manifest") {
          const bytes = Buffer.from(JSON.stringify(run.manifest)), index = integer(url.searchParams.get("chunk"), 0, 0, Math.max(0, Math.ceil(bytes.length / UPLOAD_CHUNK_BYTES) - 1));
          const chunk = bytes.subarray(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES);
          response.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" }); response.end(chunk); return true;
        }
        if (match[2].startsWith("artifacts/")) {
          let path: string;
          try { path = artifactPath(decodeURIComponent(match[2].slice("artifacts/".length))); }
          catch { throw new PlatformError(400, "Invalid artifact path"); }
          const artifact = run.artifacts.find((item) => item.path === path);
          if (!artifact) throw new PlatformError(404, "Artifact is not part of this run");
          let data = await store.get(artifact.hash);
          const isChunk = url.searchParams.has("chunk");
          if (isChunk) {
            const index = integer(url.searchParams.get("chunk"), 0, 0, Math.max(0, Math.ceil(data.length / UPLOAD_CHUNK_BYTES) - 1));
            data = data.subarray(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES);
          } else if (auth.env.VERCEL && data.length > 3 * UPLOAD_CHUNK_BYTES) throw new PlatformError(413, "Use chunked artifact downloads on Vercel; the dashboard handles this automatically");
          response.writeHead(200, {
            "Content-Type": isChunk ? "application/octet-stream" : artifact.mediaType, "Content-Length": data.length,
            "Cache-Control": "private, no-store", ETag: `"${artifact.hash}"`,
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          });
          response.end(data); return true;
        }
      }
      throw new PlatformError(404, "API endpoint not found");
    } catch (error) {
      if (error instanceof z.ZodError) { json(response, 400, { error: "Invalid request fields", fields: error.issues.map((issue) => issue.path.join(".")) }); return true; }
      if (!(error instanceof PlatformError)) console.error("Platform API request failed", error);
      json(response, error instanceof PlatformError ? error.status : 500, { error: error instanceof PlatformError ? error.message : "Unable to read platform evidence; check server logs" });
      return true;
    }
  };
  return Object.assign(handler, { ready: auth.ready });
}
