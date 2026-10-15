import { openPlatform } from "./config.js";
import { PlatformError } from "./errors.js";
import { findProject, projectSelector } from "./project-selector.js";
import { projectId, parseMetadata } from "./validation.js";
import { importRun } from "./ingest.js";
import { uploadRun } from "./upload-client.js";
import type { RunMetadata } from "../shared/contracts.js";

/** Called only for an explicitly supplied `test <project>` argument. */
export async function prepareTestBinding(options: {
  project: string;
  server?: string;
  metadata: RunMetadata;
  env?: NodeJS.ProcessEnv;
}) {
  const selector = projectSelector(options.project),
    metadata = parseMetadata(options.metadata);
  const env = { ...(options.env ?? process.env) };
  if (options.server !== undefined) {
    let server: URL;
    try {
      server = new URL(options.server);
    } catch {
      throw new PlatformError(
        400,
        "Dashboard URL must be an HTTP(S) origin, such as https://dashboard.example.com",
      );
    }
    if (
      server.pathname !== "/" ||
      server.search ||
      server.hash ||
      server.username ||
      server.password ||
      !["http:", "https:"].includes(server.protocol)
    )
      throw new PlatformError(
        400,
        "Dashboard URL must be an HTTP(S) origin without a path or credentials",
      );
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname);
    if (!loopback && server.protocol !== "https:")
      throw new PlatformError(400, "Remote dashboards require HTTPS");
    const token = env.VISUALGUARD_UPLOAD_TOKEN;
    if (!token && !loopback)
      throw new PlatformError(
        400,
        "Set VISUALGUARD_UPLOAD_TOKEN to an upload token for this project",
      );
    const url = new URL("/api/publishing/project", server);
    url.searchParams.set("project", selector);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    let value: { id?: string; name?: string; publicId?: string; error?: string };
    try {
      value = (await response.json()) as typeof value;
    } catch {
      throw new Error(
        `Dashboard project lookup returned an invalid response (${response.status}); use a dashboard version supporting test project binding`,
      );
    }
    if (!response.ok)
      throw new PlatformError(
        response.status,
        `${value.error ?? "Unable to resolve a permitted dashboard project"}${response.status === 401 || response.status === 403 ? "; set VISUALGUARD_UPLOAD_TOKEN to this project's active upload token" : ""}`,
      );
    if (typeof value.id !== "string" || typeof value.name !== "string" ||
      (value.publicId !== undefined && typeof value.publicId !== "string"))
      throw new Error("Dashboard returned an invalid project");
    const id = projectId(value.id),
      name = value.name;
    return {
      id,
      name,
      publicId: value.publicId === undefined ? id : projectId(value.publicId),
      destination: server.origin,
      async publish(runDir: string) {
        return uploadRun({ server: server.origin, project: id, runDir, metadata, token });
      },
    };
  }
  // No listener is needed locally. The same environment/data directory as `dashboard` is used.
  const platform = await openPlatform(env);
  let selected: { id: string; name: string; publicId?: string };
  try {
    const existing = findProject(await platform.repository.projects(), selector);
    if (existing) selected = existing;
    else {
      projectId(selector);
      selected = await platform.repository.createProject(selector, selector);
    }
  } finally {
    await platform.close();
  }
  const { id, name } = selected;
  return {
    id,
    name,
    publicId: selected.publicId ?? id,
    destination:
      env.VISUALGUARD_DATABASE_URL || env.DATABASE_URL
        ? "configured dashboard database"
        : "local dashboard storage",
    async publish(runDir: string) {
      const target = await openPlatform(env);
      try {
        const result = await importRun(target.repository, target.store, {
          projectId: id,
          runDir,
          metadata,
        });
        return {
          id: result.run.id,
          status: result.run.status,
          duplicate: result.duplicate,
          url: `/runs/${result.run.id}`,
        };
      } finally {
        await target.close();
      }
    },
  };
}
