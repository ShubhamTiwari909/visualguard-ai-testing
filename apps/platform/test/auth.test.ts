import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type Database } from "../server/database.js";
import { Repository } from "../server/repository.js";
import { SqlStateStore } from "../server/state.js";
import { SqlArtifactStore } from "../server/artifacts.js";
import { createApi } from "../server/http.js";
import { AuthService } from "../server/auth.js";

describe("F02 organization access", () => {
  let root: string, db: Database, server: Server, base: string;
  let repository: Repository, state: SqlStateStore, store: SqlArtifactStore;
  const password = "test-only-password-long";
  let adminCookie: string, adminCsrf: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-auth-")); db = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
    repository = new Repository(db); state = new SqlStateStore(db); store = new SqlArtifactStore(db);
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener");
    base = `http://127.0.0.1:${address.port}`;
    const api = createApi(repository, store, { state, env: { VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: base, VISUALGUARD_ADMIN_EMAIL: "admin@example.test", VISUALGUARD_ADMIN_PASSWORD: password } });
    server.on("request", (request, response) => { void api(request, response).then((handled) => { if (!handled) { response.writeHead(404); response.end(); } }); });
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password }) });
    expect(response.status).toBe(200); adminCookie = response.headers.get("set-cookie")!.split(";")[0]!;
    adminCsrf = (await (await fetch(`${base}/api/session`, { headers: { Cookie: adminCookie } })).json()).token;
    await repository.createProject("private-a", "Private A"); await repository.createProject("private-b", "Private B");
  });
  afterEach(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); await db?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  const headers = (cookie: string, csrf?: string) => ({ "Content-Type": "application/json", Cookie: cookie, ...(csrf ? { "x-visualguard-platform-token": csrf } : {}) });

  async function member() {
    const response = await fetch(`${base}/api/users`, { method: "POST", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ name: "Reviewer", email: "member@example.test", password }) });
    expect(response.status).toBe(201); const user = await response.json();
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "member@example.test", password }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const session = await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json();
    return { user, cookie, csrf: session.token };
  }

  it("requires login and never leaks password hashes or bootstrap credentials", async () => {
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    const session = await (await fetch(`${base}/api/session`)).json(); expect(session.user).toBeNull(); expect(session.token).toBeUndefined();
    const users = await (await fetch(`${base}/api/users`, { headers: { Cookie: adminCookie } })).text();
    expect(users).not.toContain("scrypt$"); expect(users).not.toContain(password);
    expect(adminCookie).toMatch(/^vg_session=/);
    const stored = await state.list<{ passwordHash: string }>("users"); expect(stored[0]?.value.passwordHash).toMatch(/^scrypt\$/);
  });
  it("limits a member to explicitly assigned projects, including filters", async () => {
    const person = await member();
    expect((await (await fetch(`${base}/api/projects`, { headers: { Cookie: person.cookie } })).json()).projects).toEqual([]);
    const assign = await fetch(`${base}/api/projects/private-a/members`, { method: "POST", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ userId: person.user.id, role: "viewer" }) });
    expect(assign.status).toBe(200);
    const list = await (await fetch(`${base}/api/projects`, { headers: { Cookie: person.cookie } })).json(); expect(list.projects.map((project: { id: string }) => project.id)).toEqual(["private-a"]);
    expect((await fetch(`${base}/api/projects/private-b/members`, { headers: { Cookie: person.cookie } })).status).toBe(403);
    expect((await fetch(`${base}/api/projects`, { method: "POST", headers: headers(person.cookie, person.csrf), body: JSON.stringify({ id: "other", name: "Other" }) })).status).toBe(403);
    expect((await (await fetch(`${base}/api/runs?project=private-b`, { headers: { Cookie: person.cookie } })).json()).total).toBe(0);
  });
  it("protects run details and artifact bytes from a member without project access", async () => {
    const person = await member();
    const hash = await store.put(Buffer.from('{"private":true}'));
    const manifest = { schemaVersion: 1, id: "private-run", number: 1, startedAt: "2026-10-15T10:00:00.000Z", durationMs: 0, mode: "compare", tool: { version: "2.0.0" }, config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" }, summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 }, jobs: [] } as import("../../../packages/visualguard/src/core/types.js").RunManifest;
    const result = await repository.insertRun({ envelopeVersion: 1, projectId: "private-b", engineRunId: manifest.id, number: 1, startedAt: manifest.startedAt, importedAt: manifest.startedAt, durationMs: 0, mode: "compare", status: "incomplete", complete: false, completenessReasons: ["No checks"], summary: manifest.summary, metadata: { environment: "private" }, digest: "a".repeat(64), jobCount: 0, manifest, artifacts: [{ path: "private.json", hash, size: 16, mediaType: "application/json" }] });
    expect((await fetch(`${base}/api/runs/${result.run.id}`, { headers: { Cookie: person.cookie } })).status).toBe(403);
    expect((await fetch(`${base}/api/runs/${result.run.id}/artifacts/private.json`, { headers: { Cookie: person.cookie } })).status).toBe(403);
  });
  it("protects mutations, rejects cross-origin calls, and revokes logged-out sessions", async () => {
    expect((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: headers(adminCookie) })).status).toBe(403);
    expect((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...headers(adminCookie, adminCsrf), Origin: "https://attacker.test" } })).status).toBe(403);
    expect((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: headers(adminCookie, adminCsrf) })).status).toBe(200);
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: adminCookie } })).status).toBe(401);
  });
  it("invalidates existing sessions when an account is disabled", async () => {
    const person = await member();
    expect((await fetch(`${base}/api/users/${person.user.id}`, { method: "PATCH", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ disabled: true }) })).status).toBe(200);
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: person.cookie } })).status).toBe(401);
  });
  it("supports password rotation and revokes the previous browser session", async () => {
    const response = await fetch(`${base}/api/auth/password`, { method: "POST", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ current: password, password: "rotated-test-password-long" }) });
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: adminCookie } })).status).toBe(401);
    const next = response.headers.get("set-cookie")!.split(";")[0]!;
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: next } })).status).toBe(200);
  });
  it("issues hashed project upload credentials and revokes them immediately", async () => {
    const response = await fetch(`${base}/api/projects/private-a/tokens`, { method: "POST", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ name: "CI", days: 1 }) });
    expect(response.status).toBe(201); const credential = await response.json(); expect(credential.token).toMatch(/^vg_upload_/);
    expect((await fetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${credential.token}` } })).status).toBe(403);
    expect(JSON.stringify(await state.list("tokens"))).not.toContain(credential.token);
    expect((await fetch(`${base}/api/projects/private-a/tokens/${credential.id}`, { method: "DELETE", headers: headers(adminCookie, adminCsrf) })).status).toBe(200);
    expect((await fetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${credential.token}` } })).status).toBe(401);
  });
  it("keeps session state across API instances", async () => {
    const auth = new AuthService(state, { VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: base });
    await auth.ready;
    const request = { headers: { cookie: adminCookie } } as Parameters<AuthService["actor"]>[0];
    expect((await auth.actor(request))?.admin).toBe(true);
  });
  it("does not allow local authentication on a publicly exposed origin", () => {
    expect(() => new AuthService(state, { VISUALGUARD_AUTH_MODE: "local", VISUALGUARD_PUBLIC_URL: "https://dashboard.example.test" })).toThrow("cannot be exposed");
  });
});
