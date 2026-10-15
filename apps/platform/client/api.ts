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
  run: (id: string, signal: AbortSignal) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`, { signal }),
  async createProject(id: string, name: string): Promise<Project> {
    const { token } = await request<{ token: string }>("/api/session");
    return request<Project>("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json", "x-visualguard-platform-token": token },
      body: JSON.stringify({ id, name }),
    });
  },
};

export const artifactUrl = (id: string, path: string) => `/api/runs/${encodeURIComponent(id)}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;

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
