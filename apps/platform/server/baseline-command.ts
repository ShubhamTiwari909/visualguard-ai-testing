import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { BaselineReference, BaselineVersion } from "../shared/baselines.js";
import { fingerprint } from "../../../packages/visualguard/src/core/provenance.js";
import { openPlatform } from "./config.js";
import { AuthService } from "./auth.js";
import { Baselines, baselineSet } from "./baselines.js";
import { PlatformError } from "./errors.js";
import { sha256, OBJECT_CHUNK_BYTES } from "./artifacts.js";
import { projectId } from "./validation.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const descriptor = z.object({ path: z.string(), hash, size: z.number().int().positive().max(32 * 1024 * 1024), mediaType: z.enum(["image/png", "application/json"]) });
const snapshot = z.object({
  projectId: z.string().regex(/^[a-z0-9-]{1,63}$/), set: baselineSet,
  version: z.number().int().positive(), parentVersion: z.number().int().nonnegative(),
  runId: z.string().uuid(), evidenceDigest: hash,
  sourceRevision: z.string(), targetRevision: z.string(), promotedAt: z.string().datetime(), policyVersion: z.literal(1),
  entries: z.array(z.object({ key: hash, name: z.string(), route: z.string(), viewport: z.string(), jobId: z.string().regex(/^[a-zA-Z0-9_-]{1,220}$/), image: descriptor, dom: descriptor.optional(), renderingIdentity: z.object({ platform: z.string(), project: z.string().optional(), policy: z.record(z.string(), z.unknown()) }).passthrough(), health: z.record(z.string(), z.unknown()) }).passthrough()).min(1).max(1000),
}).passthrough();

export interface PullBaselineOptions { project: string; set: string; out: string; version?: number; server?: string; env?: NodeJS.ProcessEnv }
/** Install only into a new directory; downloads are staged and verified before publication. */
export async function pullApprovedBaseline(options: PullBaselineOptions) {
  projectId(options.project);
  baselineSet.parse(options.set);
  if (options.version !== undefined && (!Number.isSafeInteger(options.version) || options.version < 1)) throw new PlatformError(400, "Version must be a positive integer");
  const target = resolve(options.out), env = options.env ?? process.env;
  try { await stat(target); throw new PlatformError(409, "Output directory already exists; choose a new directory to pin this version"); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  let close = async () => {}, version: BaselineVersion, get: (hash: string, size: number) => Promise<Buffer>;
  const origin = options.server ?? env.VISUALGUARD_DASHBOARD_URL;
  try {
    if (origin) {
      let server: URL;
      try { server = new URL(origin); } catch { throw new PlatformError(400, "Dashboard server must be an HTTP(S) origin"); }
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname);
      if (!["http:", "https:"].includes(server.protocol) || server.username || server.password || server.pathname !== "/" || server.search || server.hash || (!loopback && server.protocol !== "https:")) throw new PlatformError(400, "Use an HTTPS dashboard origin (HTTP is allowed on loopback)");
      const base = `/api/projects/${options.project}/baselines/${options.set}`;
      const request = async (path: string) => {
        const response = await fetch(new URL(path, server), { redirect: "error", headers: env.VISUALGUARD_UPLOAD_TOKEN ? { Authorization: `Bearer ${env.VISUALGUARD_UPLOAD_TOKEN}` } : {}, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new PlatformError(response.status, `Approved baseline download failed (${response.status}); check project, version and upload token`);
        return response;
      };
      const response = await request(`${base}${options.version ? `?version=${options.version}` : ""}`);
      // Bound actual bytes even when Content-Length is missing or dishonest.
      const reader = response.body!.getReader(), parts: Uint8Array[] = [];
      let length = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 2 * 1024 * 1024) throw new PlatformError(413, "Baseline snapshot exceeds 2 MiB"); parts.push(part.value); } } finally { await reader.cancel(); }
      version = snapshot.parse(JSON.parse(Buffer.concat(parts).toString("utf8"))) as unknown as BaselineVersion;
      if (version.set !== options.set || (options.version && version.version !== options.version)) throw new PlatformError(409, "Dashboard returned a different baseline version");
      get = async (digest, size) => {
        const data = Buffer.alloc(size);
        for (let offset = 0, chunk = 0; offset < size; offset += OBJECT_CHUNK_BYTES, chunk++) {
          const response = await request(`${base}/artifacts/${digest}?version=${version.version}&chunk=${chunk}`);
          const expected = Math.min(OBJECT_CHUNK_BYTES, size - offset);
          const reader = response.body!.getReader();
          let received = 0;
          try { for (;;) { const part = await reader.read(); if (part.done) break; if (received + part.value.length > expected) throw new PlatformError(409, "Baseline chunk exceeds expected size"); data.set(part.value, offset + received); received += part.value.length; } } finally { await reader.cancel(); }
          if (received !== expected) throw new PlatformError(409, "Baseline chunk is incomplete");
        }
        return data;
      };
    } else {
      const platform = await openPlatform(env);
      close = platform.close;
      const auth = new AuthService(platform.state, { ...env, VISUALGUARD_AUTH_MODE: "local", VISUALGUARD_PUBLIC_URL: undefined });
      await auth.ready;
      const project = await platform.repository.resolveProjectId(options.project);
      version = await new Baselines(platform.repository, platform.state, auth).version({ id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: "" }, project, options.set, options.version);
      snapshot.parse(version);
      get = async digest => platform.store.get(digest);
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = await mkdtemp(join(dirname(target), ".visualguard-baseline-"));
    try {
      const files = new Set<string>();
      let total = 0;
      for (const entry of version.entries) {
        if (entry.key !== fingerprint({ jobId: entry.jobId, route: entry.route, viewport: entry.viewport, identity: entry.renderingIdentity })) throw new PlatformError(409, "Baseline check identity is inconsistent");
        // IDs are used as file names only after strict validation; source paths never reach disk.
        const subdir = (entry.renderingIdentity as { project?: string }).project !== undefined ? "playwright" : "";
        const stem = join(subdir, entry.jobId);
        if (files.has(stem)) throw new PlatformError(409, "Baseline contains duplicate output identities");
        files.add(stem);
        const path = join(temporary, stem);
        await mkdir(dirname(path), { recursive: true });
        const writeArtifact = async (artifact: typeof entry.image, suffix: string) => {
          total += artifact.size;
          if (total > 512 * 1024 * 1024) throw new PlatformError(413, "Baseline download exceeds 512 MiB");
          const bytes = await get(artifact.hash, artifact.size);
          if (bytes.length !== artifact.size || sha256(bytes) !== artifact.hash) throw new PlatformError(409, "Approved artifact checksum mismatch");
          await writeFile(`${path}${suffix}`, bytes, { flag: "wx" });
        };
        await writeArtifact(entry.image, ".png");
        if (entry.dom) await writeArtifact(entry.dom, ".dom.json");
        const health = Buffer.from(JSON.stringify(entry.health));
        await writeFile(`${path}.health.json`, health, { flag: "wx" });
        const approvedReference: BaselineReference = { projectId: version.projectId, set: version.set, version: version.version, checkKey: entry.key, runId: version.runId, evidenceDigest: version.evidenceDigest, sourceRevision: version.sourceRevision, targetRevision: version.targetRevision, promotedAt: version.promotedAt, policyVersion: 1 };
        await writeFile(`${path}.meta.json`, JSON.stringify({ version: 1, identity: entry.renderingIdentity, fingerprint: fingerprint(entry.renderingIdentity), sourceRevision: version.sourceRevision, createdAt: version.promotedAt, approvedReference, approvedArtifacts: { image: entry.image.hash, dom: entry.dom?.hash, health: sha256(health) } }, null, 2), { flag: "wx" });
      }
      await writeFile(join(temporary, "approved-baseline.json"), JSON.stringify({ projectId: version.projectId, set: version.set, version: version.version, runId: version.runId, sourceRevision: version.sourceRevision, targetRevision: version.targetRevision, policyVersion: 1, checks: version.entries.map(entry => ({ jobId: entry.jobId, key: entry.key })) }, null, 2), { flag: "wx" });
      // Each staged snapshot is nonempty: another completed pull cannot be overwritten.
      await rename(temporary, target);
      return { directory: target, projectId: version.projectId, set: version.set, version: version.version, checks: version.entries.length };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  } finally { await close(); }
}
