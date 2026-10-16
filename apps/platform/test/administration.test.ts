import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService, type User } from "../server/auth.js";
import { openDatabase, type Database } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";
import { Repository } from "../server/repository.js";
import { SqlArtifactStore, sha256 } from "../server/artifacts.js";
import { createApi } from "../server/http.js";
import { reviewRun } from "./fixtures/review-run.js";

type Browser = { cookie?: string; csrf?: string };
describe("workspace administration API and permissions", () => {
  let root: string, db: Database, state: SqlStateStore, repository: Repository, auth: AuthService, base: string, server: Server, admin: Browser;
  const password = "test-only-password-long";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-admin-api-")); db = await openDatabase({ sqlitePath: join(root, "dashboard.sqlite") });
    state = new SqlStateStore(db); repository = new Repository(db);
    server = createServer(); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener"); base = `http://127.0.0.1:${address.port}`;
    const env = { VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: base, VISUALGUARD_ADMIN_EMAIL: "admin@example.test", VISUALGUARD_ADMIN_PASSWORD: password };
    auth = new AuthService(state, env); await auth.ready;
    const api = createApi(repository, new SqlArtifactStore(db), { state, env }); await api.ready;
    server.on("request", (request, response) => { void api(request, response); });
    admin = await login("admin@example.test"); await repository.createProject("private-a", "Private A"); await repository.createProject("private-b", "Private B");
  });
  afterEach(async () => { vi.restoreAllMocks(); server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); await db?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  async function req(jar: Browser, path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: jar.cookie ?? "", "x-visualguard-platform-token": jar.csrf ?? "", ...(data ? { "Content-Type": "application/json" } : {}), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    if (response.headers.get("set-cookie")) jar.cookie = response.headers.get("set-cookie")!.split(";")[0];
    const value = await response.json(); if (path === "/api/session") jar.csrf = value.token;
    return { status: response.status, value, headers: response.headers };
  }
  async function login(email: string, secret = password) {
    const jar: Browser = {}; expect((await req(jar, "/api/auth/login", "POST", { email, password: secret })).status).toBe(200); await req(jar, "/api/session"); return jar;
  }
  async function member(email = "member@example.test", role: "admin" | "member" = "member") {
    const user = await auth.createUser({ email, name: "Member", password, role }); return { user, jar: await login(email) };
  }
  async function change(id: string, input: Record<string, unknown>, jar = admin) {
    const detail = await req(admin, `/api/users/${id}`);
    return req(jar, `/api/users/${id}`, "PATCH", { expectedVersion: detail.value.user.version, currentPassword: password, ...input });
  }
  it("returns safe methods and membership details with bounded account, filter and membership pagination", async () => {
    const adminId = (await req(admin, "/api/session")).value.user.id;
    for (let i = 0; i < 205; i++) {
      const id = `directory-${String(i).padStart(3, "0")}`;
      await state.create<User>("users", id, { id, name: `Directory person ${i}`, email: `${id}@example.test`, role: i % 2 ? "member" : "admin", disabled: i % 3 === 0, authVersion: 1, passwordHash: "private-test-hash", createdAt: new Date().toISOString() });
    }
    const first = await req(admin, "/api/users"); expect(first.value.users).toHaveLength(50); expect(first.value.after).toBeDefined();
    const second = await req(admin, `/api/users?after=${encodeURIComponent(first.value.after)}`); expect(second.value.users).toHaveLength(50);
    expect(new Set([...first.value.users, ...second.value.users].map((u: { id: string }) => u.id)).size).toBe(100);
    const filter = await req(admin, "/api/users?query=directory&role=member&status=disabled"); expect(filter.value.users.length).toBeGreaterThan(0);
    expect(filter.value.users.every((u: { role: string; disabled: boolean }) => u.role === "member" && u.disabled)).toBe(true);
    const sparse = await req(admin, "/api/users?query=absent"); expect(sparse.value.users).toHaveLength(0); expect(sparse.value.after).toBeDefined();
    await state.create("user-identities", `${adminId}:safe-mapping`, { provider: "google", identityKey: "private-identity-key" });
    for (let i = 0; i < 53; i++) await state.create("memberships", `${adminId}:project-${String(i).padStart(3, "0")}`, { userId: adminId, projectId: `project-${i}`, role: "reviewer" });
    const detail = await req(admin, `/api/users/${adminId}`); expect(detail.value.user.methods).toEqual(["password", "google"]); expect(detail.value.memberships).toHaveLength(50);
    expect((await req(admin, `/api/users/${adminId}?after=${encodeURIComponent(detail.value.after)}`)).value.memberships).toHaveLength(3);
    const serialized = JSON.stringify([first.value, detail.value]); expect(serialized).not.toMatch(/private-test-hash|passwordHash|authVersion|private-identity-key|sessionId/);
    expect(detail.headers.get("cache-control")).toBe("no-store");
    expect((await req(admin, `/api/users/${adminId}?after=another-user:project`)).status).toBe(400);
  });
  it.each(["viewer", "reviewer", "maintainer"])("denies %s workspace user administration, including across projects", async (role) => {
    const person = await member(); await req(admin, "/api/projects/private-a/members", "POST", { userId: person.user.id, role });
    for (const path of ["/api/users", `/api/users/${person.user.id}`]) expect((await req(person.jar, path)).status).toBe(403);
    expect((await req(person.jar, `/api/users/${person.user.id}`, "PATCH", { expectedVersion: 1, currentPassword: password, role: "admin" })).status).toBe(403);
    expect((await req(person.jar, `/api/users/${person.user.id}/revoke-sessions`, "POST", { expectedVersion: 1, currentPassword: password })).status).toBe(403);
    expect((await req(person.jar, "/api/users", "POST", { email: "other@example.test", name: "Other", password })).status).toBe(403);
  });
  it("requires current-password proof, CSRF, same origin, and the current account version", async () => {
    const person = await member();
    expect((await change(person.user.id, { role: "admin", currentPassword: "wrong" })).status).toBe(401);
    expect((await change(person.user.id, { role: "admin", currentPassword: undefined })).status).toBe(401);
    expect((await req(admin, `/api/users/${person.user.id}`, "PATCH", { expectedVersion: 1, currentPassword: password, disabled: true }, { "x-visualguard-platform-token": "" })).status).toBe(403);
    expect((await req(admin, `/api/users/${person.user.id}`, "PATCH", { expectedVersion: 1, currentPassword: password, disabled: true }, { Origin: "https://other.test" })).status).toBe(403);
    expect((await change(person.user.id, { role: "admin" })).status).toBe(200);
    expect((await req(admin, `/api/users/${person.user.id}`, "PATCH", { expectedVersion: 1, currentPassword: password, disabled: true })).status).toBe(409);
    expect((await req(admin, `/api/users/${person.user.id}`, "PATCH", { disabled: true, currentPassword: password })).status).toBe(400);
  });
  it("grants workspace administration only through explicit promotion, with demotion revoking the old session", async () => {
    const blocked = await req(admin, "/api/users", "POST", { email: "new-admin@example.test", name: "Admin", password, role: "admin" }); expect(blocked.status).toBe(400);
    const person = await member(); expect((await change(person.user.id, { role: "admin" })).status).toBe(200);
    expect((await req(person.jar, "/api/users")).status).toBe(401); person.jar = await login(person.user.email);
    expect((await req(person.jar, "/api/users")).status).toBe(200);
    expect((await change(person.user.id, { role: "member" })).status).toBe(200);
    expect((await req(person.jar, "/api/users")).status).toBe(401); person.jar = await login(person.user.email);
    expect((await req(person.jar, "/api/users")).status).toBe(403);
    expect((await req(person.jar, "/api/projects")).value.projects).toHaveLength(0);
  });
  it("keeps old sessions and both legacy/new upload credentials revoked after account restoration", async () => {
    const person = await member(); await req(admin, "/api/projects/private-a/members", "POST", { userId: person.user.id, role: "maintainer" });
    const token = (await req(person.jar, "/api/projects/private-a/tokens", "POST", { name: "CI", days: 1 })).value.token;
    await state.create("tokens", sha256("legacy-upload"), { ownerId: person.user.id, projectId: "private-a", name: "Legacy" });
    const upload = async (value: string) => req({}, "/api/publishing/project?project=private-a", "GET", undefined, { Authorization: `Bearer ${value}` });
    expect((await upload(token)).status).toBe(200); expect((await upload("legacy-upload")).status).toBe(200);
    expect((await req({}, "/api/users", "GET", undefined, { Authorization: `Bearer ${token}` })).status).toBe(403);
    expect((await change(person.user.id, { disabled: true })).status).toBe(200);
    expect((await upload(token)).status).toBe(401); expect((await upload("legacy-upload")).status).toBe(401);
    expect((await req(admin, "/api/projects/private-b/members", "POST", { userId: person.user.id, role: "viewer" })).status).toBe(400);
    expect((await change(person.user.id, { disabled: false })).status).toBe(200);
    expect((await upload(token)).status).toBe(401); expect((await upload("legacy-upload")).status).toBe(401); expect((await req(person.jar, "/api/projects")).status).toBe(401);
    person.jar = await login(person.user.email); expect((await req(person.jar, "/api/projects")).value.projects.map((p: { id: string }) => p.id)).toEqual(["private-a"]);
    const fresh = (await req(person.jar, "/api/projects/private-a/tokens", "POST", { name: "New CI", days: 1 })).value.token; expect((await upload(fresh)).status).toBe(200);
  });
  it("invalidates a token minted concurrently with an administrator revocation", async () => {
    const person = await member(); await req(admin, "/api/projects/private-a/members", "POST", { userId: person.user.id, role: "maintainer" });
    const actor = (await auth.actor({ headers: { cookie: admin.cookie } } as IncomingMessage))!;
    const create = state.create.bind(state); let injected = false;
    vi.spyOn(state, "create").mockImplementation(async (ns, ...args) => {
      if (ns === "tokens" && !injected) { injected = true; await auth.updateUser(actor, person.user.id, { expectedVersion: (await state.get("users", person.user.id))!.version, currentPassword: password, revoke: true }); }
      return create(ns, ...args);
    });
    const minted = await req(person.jar, "/api/projects/private-a/tokens", "POST", { name: "In flight", days: 1 }); expect(minted.status).toBe(201); expect(injected).toBe(true);
    expect((await req({}, "/api/publishing/project?project=private-a", "GET", undefined, { Authorization: `Bearer ${minted.value.token}` })).status).toBe(401);
  });
  it("revokes sessions without disabling the account and allows a fresh sign-in", async () => {
    const person = await member(), detail = await req(admin, `/api/users/${person.user.id}`);
    const result = await req(admin, `/api/users/${person.user.id}/revoke-sessions`, "POST", { expectedVersion: detail.value.user.version, currentPassword: password }); expect(result.status).toBe(200);
    expect(result.value.disabled).toBe(false); expect((await req(person.jar, "/api/projects")).status).toBe(401);
    expect((await req(await login(person.user.email), "/api/projects")).status).toBe(200);
  });
  it("protects the current administrator and lets them deliberately revoke their own sessions", async () => {
    const id = (await req(admin, "/api/session")).value.user.id;
    expect((await change(id, { disabled: true })).status).toBe(400); expect((await change(id, { role: "member" })).status).toBe(400);
    const detail = await req(admin, `/api/users/${id}`);
    expect((await req(admin, `/api/users/${id}/revoke-sessions`, "POST", { expectedVersion: detail.value.user.version, currentPassword: password })).status).toBe(200);
    expect((await req(admin, "/api/projects")).status).toBe(401); expect((await req(await login("admin@example.test"), "/api/users")).status).toBe(200);
  });
  it("resets existing passwords without exposing hashes and rejects adding a password to a provider-only account", async () => {
    const person = await member(), next = "another-test-password-long";
    expect((await change(person.user.id, { password: next })).status).toBe(200);
    expect((await req({}, "/api/auth/login", "POST", { email: person.user.email, password })).status).toBe(401);
    expect((await req(await login(person.user.email, next), "/api/projects")).status).toBe(200);
    const row = (await state.get<User>("users", person.user.id))!; delete row.value.passwordHash; await state.replace("users", row);
    expect((await change(person.user.id, { password: next })).status).toBe(400);
    expect(JSON.stringify((await req(admin, "/api/audit")).value)).not.toMatch(/another-test-password|scrypt\$/);
  });
  it("keeps F03 history and restores effective decisions only when reviewer access returns", async () => {
    const person = await member(); await req(admin, "/api/projects/private-a/members", "POST", { userId: person.user.id, role: "reviewer" });
    const fixture = reviewRun(); fixture.projectId = "private-a"; const { id: _id, ...document } = fixture; const { run } = await repository.insertRun(document);
    const path = `/api/runs/${run.id}/reviews`, first = (await req(person.jar, `${path}?job=checkout__desktop`)).value;
    const accepted = await req(person.jar, path, "POST", { jobId: first.jobId, evidenceDigest: first.evidenceDigest, scopeDigest: first.scopeDigest, expectedVersion: first.version, event: { action: "approve_visual_change", reason: "Intentional change" } }); expect(accepted.status).toBe(200);
    expect((await change(person.user.id, { disabled: true })).status).toBe(200);
    const unavailable = (await req(admin, `${path}?job=checkout__desktop`)).value; expect(unavailable.status).toBe("pending"); expect(unavailable.events[0].actor.id).toBe(person.user.id);
    expect((await change(person.user.id, { disabled: false })).status).toBe(200);
    const restored = (await req(admin, `${path}?job=checkout__desktop`)).value; expect(restored.status).toBe("approved"); expect(restored.events).toEqual(unavailable.events);
  });
  it("requires recent provider authentication for admins without a password", async () => {
    const providerAdmin = await member("provider-admin@example.test", "admin"), target = await member();
    const user = (await state.get<User>("users", providerAdmin.user.id))!; delete user.value.passwordHash; await state.replace("users", user);
    const sessionId = sha256(providerAdmin.jar.cookie!.slice("vg_session=".length)), session = (await state.get("sessions", sessionId))!;
    const data = { userId: user.id, authVersion: 1, csrf: providerAdmin.jar.csrf, authentication: "oidc", authenticatedAt: new Date(Date.now() - 301000).toISOString() };
    await state.replace("sessions", { ...session, value: data });
    expect((await change(target.user.id, { role: "admin", currentPassword: undefined }, providerAdmin.jar)).status).toBe(401);
    await state.replace("sessions", { ...session, version: session.version + 1, value: { ...data, authenticatedAt: new Date().toISOString() } });
    expect((await change(target.user.id, { role: "admin", currentPassword: undefined }, providerAdmin.jar)).status).toBe(200);
  });
});
