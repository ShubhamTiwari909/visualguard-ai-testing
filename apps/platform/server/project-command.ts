import { openPlatform } from "./config.js";
import { PlatformError } from "./errors.js";
import { projectId } from "./validation.js";
import type { Project } from "../shared/contracts.js";

export interface CreateProjectOptions { id: string; name?: string; server?: string; env?: NodeJS.ProcessEnv }

/** Idempotent creation by stable ID. Existing project names, access and evidence are preserved. */
export async function createDashboardProject(options: CreateProjectOptions): Promise<{ project: Project; created: boolean }> {
  const id = projectId(options.id), name = options.name ?? id;
  if (!name.trim() || name.length > 120) throw new PlatformError(400, "Project name must contain 1–120 characters");
  const env = { ...(options.env ?? process.env) };
  const origin = options.server ?? (env.VISUALGUARD_DASHBOARD_URL || undefined);
  if (origin === undefined) {
    const platform = await openPlatform(env);
    try { return await platform.repository.ensureProject(id, name); }
    finally { await platform.close(); }
  }
  let server: URL;
  try { server = new URL(origin); }
  catch { throw new PlatformError(400, "Dashboard server must be an HTTP(S) origin"); }
  if (server.pathname !== "/" || server.search || server.hash || server.username || server.password || !["http:", "https:"].includes(server.protocol)) throw new PlatformError(400, "Dashboard server must be an HTTP(S) origin without a path or credentials");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname);
  if (!loopback && server.protocol !== "https:") throw new PlatformError(400, "Remote dashboard administration requires HTTPS");
  let cookie = "", csrf = "";
  const request = async (path: string, method = "GET", data?: unknown) => {
    const response = await fetch(new URL(path, server), {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...(csrf ? { "x-visualguard-platform-token": csrf } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error(`Dashboard returned an invalid response (${response.status})`); }
    if (!response.ok) throw new PlatformError(response.status, value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `Dashboard request failed (${response.status})`);
    return { response, value };
  };
  type Session = { access?: string; token?: string; user?: { admin?: boolean } | null };
  const readSession = async (): Promise<Session> => {
    const { value } = await request("/api/session");
    if (!value || typeof value !== "object" || !("access" in value) || !["local", "login"].includes(String(value.access))) throw new Error("Dashboard returned an invalid session response");
    return value as Session;
  };
  try {
    let session = await readSession();
    if (session.access === "local" && !loopback) throw new PlatformError(403, "Unauthenticated project creation is restricted to loopback dashboards");
    if (session.access !== "local") {
      const email = env.VISUALGUARD_ADMIN_EMAIL, password = env.VISUALGUARD_ADMIN_PASSWORD;
      if (!email || !password) throw new PlatformError(401, "Project creation requires an administrator login. Set VISUALGUARD_ADMIN_EMAIL and VISUALGUARD_ADMIN_PASSWORD in your environment or --env-file. Project upload tokens cannot create projects.");
      const login = await request("/api/auth/login", "POST", { email, password });
      cookie = login.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
      if (!cookie) throw new Error("Dashboard login did not return an administrator session");
      session = await readSession();
    }
    csrf = typeof session.token === "string" ? session.token : "";
    if (!session.user?.admin || typeof session.token !== "string" || !session.token) throw new PlatformError(403, "Administrator access is required to create projects");
    const { response, value } = await request("/api/projects", "POST", { id, name });
    if (!value || typeof value !== "object" || !("id" in value) || value.id !== id || !("name" in value) || typeof value.name !== "string") throw new Error("Dashboard returned an invalid project");
    const project = value as Project & { created?: boolean };
    if (typeof project.created !== "boolean") throw new Error("Upgrade the dashboard server to a version supporting idempotent CLI project creation");
    if (![200, 201].includes(response.status)) throw new Error("Dashboard returned an unexpected project creation result");
    const { created, ...result } = project;
    return { project: result, created };
  } finally {
    // The temporary administration session is never stored or printed.
    if (cookie && csrf) await request("/api/auth/logout", "POST").catch(() => {});
  }
}
