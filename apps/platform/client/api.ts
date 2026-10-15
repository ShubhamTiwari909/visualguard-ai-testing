import type { Project, RunDetail, RunPage } from "../shared/contracts";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result as T;
}

export const api = {
  projects: (signal: AbortSignal) => request<{ projects: Project[] }>("/api/projects", { signal }),
  runs: (search: string, signal: AbortSignal) => request<RunPage>(`/api/runs${search}`, { signal }),
  async run(id: string, signal: AbortSignal): Promise<RunDetail> {
    const run = await request<RunDetail & { manifestTransfer?: { size: number; hash: string; chunks: number } }>(`/api/runs/${encodeURIComponent(id)}`, { signal });
    if (run.manifestTransfer) {
      const bytes = await download(`/api/runs/${encodeURIComponent(id)}/manifest`, run.manifestTransfer.size, run.manifestTransfer.hash, signal);
      run.manifest = JSON.parse(new TextDecoder().decode(bytes)) as RunDetail["manifest"];
    }
    // Large objects use bounded responses on every deployment, including Vercel.
    for (const artifact of run.artifacts) if (artifact.size > 2 * 1024 * 1024) {
      const bytes = await download(rawArtifactUrl(id, artifact.path), artifact.size, artifact.hash, signal);
      signal.throwIfAborted();
      urls.set(`${id}:${artifact.path}`, URL.createObjectURL(new Blob([bytes], { type: artifact.mediaType })));
    }
    return run;
  },
  async createProject(id: string, name: string): Promise<Project> {
    const { token } = await request<{ token: string }>("/api/session");
    return request<Project>("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json", "x-visualguard-platform-token": token },
      body: JSON.stringify({ id, name }),
    });
  },
};

const urls = new Map<string, string>();
const rawArtifactUrl = (id: string, path: string) => `/api/runs/${encodeURIComponent(id)}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;
export const artifactUrl = (id: string, path: string) => urls.get(`${id}:${path}`) ?? rawArtifactUrl(id, path);
export function releaseArtifacts(id: string) { for (const [key, url] of urls) if (key.startsWith(`${id}:`)) { URL.revokeObjectURL(url); urls.delete(key); } }

async function download(path: string, size: number, expected: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(size), chunkBytes = 1024 * 1024;
  for (let offset = 0, chunk = 0; offset < size; offset += chunkBytes, chunk++) {
    const response = await fetch(`${path}?chunk=${chunk}`, { signal });
    if (!response.ok) throw new Error("Unable to download saved evidence");
    const part = new Uint8Array(await response.arrayBuffer());
    if (part.length !== Math.min(chunkBytes, size - offset)) throw new Error("Evidence chunk length mismatch");
    bytes.set(part, offset);
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== expected) throw new Error("Evidence checksum mismatch");
  return bytes;
}

/** Adapt only path fields in a copy. The stored manifest and original offline report stay intact. */
export function reportManifest(run: RunDetail): RunDetail["manifest"] {
  const manifest = structuredClone(run.manifest);
  for (const job of manifest.jobs) {
    for (const capture of Object.values(job.captures)) if (capture) {
      capture.image = artifactUrl(run.id, capture.image);
      if (capture.dom) capture.dom = artifactUrl(run.id, capture.dom);
    }
    if (job.diff?.image) job.diff.image = artifactUrl(run.id, job.diff.image);
    for (const region of job.regions) if (region.crops) {
      for (const key of ["production", "staging", "diff"] as const) region.crops[key] = artifactUrl(run.id, region.crops[key]);
    }
  }
  // The existing viewer already prominently explains engine-incomplete evidence.
  if (!run.complete) manifest.incomplete = true;
  return manifest;
}
