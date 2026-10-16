import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type ServerResponse, type IncomingMessage } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService, MemoryStateStore, type User } from "../server/auth.js";
import { openDatabase, type Database } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";
import { Repository } from "../server/repository.js";
import { SqlArtifactStore, sha256 } from "../server/artifacts.js";
import { createApi } from "../server/http.js";
import { Identities, legacyIdentityId } from "../server/identities.js";
import { Invitations } from "../server/invitations.js";
import { openMongo } from "../server/mongo.js";
import type { PlatformRepository } from "../server/storage-contracts.js";
import { oidcProvider } from "./fixtures/oidc-provider.js";

type Browser = { cookies: Map<string, string>; csrf?: string; joinToken?: string };
const browser = (): Browser => ({ cookies: new Map() });
describe("invitation browser API and admission policy", () => {
  let root: string, db: Database, state: SqlStateStore, repository: Repository, base: string, server: Server;
  let provider: ReturnType<typeof oidcProvider>, admin: Browser, recipient: Browser;
  const password = "test-only-password-long";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-onboarding-")); db = await openDatabase({ sqlitePath: join(root, "dashboard.sqlite") });
    state = new SqlStateStore(db); repository = new Repository(db); provider = oidcProvider(); vi.stubGlobal("fetch", provider.fetch);
    server = createServer(); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener");
    base = `http://127.0.0.1:${address.port}`;
    const api = createApi(repository, new SqlArtifactStore(db), { state, env: {
      VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: base, VISUALGUARD_ADMIN_EMAIL: "admin@example.test", VISUALGUARD_ADMIN_PASSWORD: password,
      VISUALGUARD_OIDC_ISSUER: provider.issuer, VISUALGUARD_OIDC_CLIENT_ID: provider.clientId, VISUALGUARD_OIDC_CLIENT_SECRET: provider.clientSecret,
    } });
    await api.ready; server.on("request", (request, response) => { void api(request, response); });
    admin = browser(); recipient = browser();
    expect((await req(admin, "/api/auth/login", "POST", { email: "admin@example.test", password })).status).toBe(200);
    await req(admin, "/api/session"); await repository.createProject("review-demo", "Review demo");
  });
  afterEach(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); await db?.close(); if (root) await rm(root, { recursive: true, force: true }); vi.unstubAllGlobals(); });
  async function req(jar: Browser, path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
    const result = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { Cookie: [...jar.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...(data ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "x-visualguard-platform-token": jar.csrf ?? "", "x-visualguard-onboarding-token": jar.joinToken ?? "" } : {}), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    for (const value of result.headers.getSetCookie()) { const pair = value.split(";")[0]!, split = pair.indexOf("="); jar.cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
    const value = result.headers.get("content-type")?.includes("application/json") ? await result.json() : undefined;
    if (path === "/api/session" && value?.token) jar.csrf = value.token;
    if (path === "/api/onboarding" && value?.token) jar.joinToken = value.token;
    return { status: result.status, headers: result.headers, value };
  }
  async function invite(email = "member@example.test") {
    const result = await req(admin, "/api/invitations", "POST", { email, projectId: "review-demo", role: "reviewer" });
    expect(result.status).toBe(201); return result.value as { invitation: { id: string; version: number }; link: string };
  }
  async function exchange(jar = recipient, email?: string) {
    const created = await invite(email); await req(jar, "/api/onboarding");
    const result = await req(jar, "/api/onboarding/exchange", "POST", { token: created.link.split("token=")[1] });
    expect(result.status).toBe(200); return created;
  }
  async function begin(jar = recipient) {
    const result = await req(jar, "/api/onboarding/login", "POST", {}); expect(result.status).toBe(200);
    const target = new URL(result.value.authorizationUrl);
    return `/api/auth/callback?code=${provider.authorize(target)}&state=${target.searchParams.get("state")}`;
  }
  async function verify(jar = recipient) { const path = await begin(jar); return req(jar, path); }
  it("defaults new hosted deployments to invite-only and blocks unknown ordinary sign-in", async () => {
    expect((await req(recipient, "/api/session")).value.admission).toBe("invite");
    const start = await req(recipient, "/api/auth/login"), target = new URL(start.headers.get("location")!);
    const result = await req(recipient, `/api/auth/callback?code=${provider.authorize(target)}&state=${target.searchParams.get("state")}`);
    expect(result.headers.get("location")).toBe("/?signin_error=oidc"); expect(await state.list("users")).toHaveLength(1);
    expect((await req(recipient, "/api/session")).value.user).toBeNull();
  });
  it("requires browser proof, reveals details only after matching verified Google identity, then explicitly grants access", async () => {
    const created = await exchange();
    const hidden = await req(recipient, "/api/onboarding"); expect(hidden.headers.get("cache-control")).toBe("no-store");
    expect(hidden.value.invitation).toBeUndefined(); expect(JSON.stringify(hidden.value)).not.toContain("review-demo");
    expect((await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true })).status).toBe(401);
    expect((await verify()).headers.get("location")).toBe("/invite");
    expect(await state.list("users")).toHaveLength(1); expect((await req(recipient, "/api/session")).value.user).toBeNull();
    const preview = await req(recipient, "/api/onboarding"); expect(preview.value.invitation).toMatchObject({ projectName: "Review demo", role: "reviewer", email: "member@example.test" });
    expect((await req(recipient, "/api/onboarding/accept", "POST", { confirmed: false })).status).toBe(400);
    const accepted = await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true }); expect(accepted.status).toBe(200);
    expect(accepted.value).toMatchObject({ projectId: "review-demo", alreadyAccepted: false });
    await req(recipient, "/api/session"); const projects = await req(recipient, "/api/projects"); expect(projects.value.projects).toHaveLength(1); expect(projects.value.projects[0].role).toBe("reviewer");
    const listed = await req(admin, "/api/invitations"); expect(JSON.stringify(listed.value)).not.toContain(created.link.split("token=")[1]);
    expect(JSON.stringify(listed.value)).not.toContain("tokenHash");
    const again = await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true }); expect(again.value.alreadyAccepted).toBe(true);
  });
  it.each([{ email: "other@example.test" }, { email_verified: false }, { nonce: "wrong" }])("rejects invalid recipient claims %j without consuming or creating an account", async (claims) => {
    const created = await exchange(); provider.claims = claims;
    expect((await verify()).headers.get("location")).toBe("/invite?signin_error=oidc");
    expect(await state.list("users")).toHaveLength(1);
    expect((await req(admin, "/api/invitations")).value.invitations.find((i: { id: string }) => i.id === created.invitation.id).status).toBe("pending");
    expect((await req(recipient, "/api/onboarding")).value.invitation).toBeUndefined();
  });
  it("binds callback to the browser, invitation and ticket version, rejects replay and superseded attempts", async () => {
    await exchange(); const path = await begin(); const copied = browser(); copied.cookies.set("vg_oidc", recipient.cookies.get("vg_oidc")!);
    expect((await req(copied, path)).headers.get("location")).toBe("/?signin_error=oidc");
    expect((await req(recipient, path)).headers.get("location")).toBe("/invite?signin_error=oidc");
    const second = await invite("second@example.test"), previous = await begin();
    await req(recipient, "/api/onboarding/exchange", "POST", { token: second.link.split("token=")[1] });
    expect((await req(recipient, previous)).headers.get("location")).toBe("/invite?signin_error=oidc");
    expect(await state.list("users")).toHaveLength(1);
  });
  it("rejects wrong origins, missing form tokens, missing session CSRF and upload credentials", async () => {
    await req(recipient, "/api/onboarding");
    expect((await req(recipient, "/api/onboarding/exchange", "POST", { token: "invalid" }, { "x-visualguard-onboarding-token": "" })).status).toBe(403);
    expect((await req(recipient, "/api/onboarding/exchange", "POST", { token: "invalid" }, { Origin: "https://other.test" })).status).toBe(403);
    expect((await req(admin, "/api/invitations", "POST", {}, { "x-visualguard-platform-token": "" })).status).toBe(403);
    await state.create("tokens", sha256("test-upload"), { ownerId: (await req(admin, "/api/session")).value.user.id, projectId: "review-demo", name: "CI" });
    expect((await req(recipient, "/api/invitations", "GET", undefined, { Authorization: "Bearer test-upload" })).status).toBe(403);
    expect((await req(recipient, "/api/onboarding/exchange", "POST", { token: "invalid" }, { Authorization: "Bearer test-upload" })).status).toBe(403);
  });
  it("supports password-account proof and preserves the original account without Google linking", async () => {
    const created = await req(admin, "/api/users", "POST", { email: "member@example.test", name: "Existing", password }); expect(created.status).toBe(201);
    await exchange(); expect((await verify()).headers.get("location")).toBe("/invite");
    expect((await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true })).status).toBe(409);
    expect((await req(recipient, "/api/auth/login", "POST", { email: "member@example.test", password })).status).toBe(200);
    await req(recipient, "/api/session");
    expect((await req(recipient, "/api/onboarding/prove", "POST", { currentPassword: "incorrect" })).status).toBe(401);
    expect((await req(recipient, "/api/onboarding/prove", "POST", { currentPassword: password })).status).toBe(200);
    expect((await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true })).status).toBe(200);
    expect((await req(recipient, "/api/session")).value.user.id).toBe(created.value.id); expect(await state.list("users")).toHaveLength(2);
    expect(await state.list("external-identities")).toHaveLength(0);
  });
  it("retries a committed acceptance safely if session issuance fails", async () => {
    await exchange(); await verify();
    const create = state.create.bind(state);
    const spy = vi.spyOn(state, "create").mockImplementation(async (ns, ...args) => ns === "sessions" ? false : create(ns, ...args));
    expect((await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true })).status).toBe(503);
    spy.mockRestore();
    expect((await state.list("memberships"))).toHaveLength(1); expect(await state.list("users")).toHaveLength(2);
    const retry = await req(recipient, "/api/onboarding/accept", "POST", { confirmed: true });
    expect(retry.status).toBe(200); expect(retry.value.alreadyAccepted).toBe(true); expect(await state.list("memberships")).toHaveLength(1);
  });
  it("rejects cancellation before the Google handoff without contacting the provider", async () => {
    const made = await exchange(); await req(admin, `/api/invitations/${made.invitation.id}/cancel`, "POST", { expectedVersion: 1 });
    expect((await req(recipient, "/api/onboarding/login", "POST", {})).status).toBe(400); expect(provider.discoveryRequests).toBe(0);
  });
  it("uses canonical project IDs through aliases and rejects non-admin management", async () => {
    await repository.updateProject("review-demo", "Renamed demo", "renamed-demo", 0);
    const made = await req(admin, "/api/invitations", "POST", { email: "member@example.test", projectId: "renamed-demo", role: "viewer" });
    expect(made.value.invitation.projectId).toBe("review-demo");
    expect((await req(recipient, "/api/invitations")).status).toBe(401);
    await req(admin, `/api/invitations/${made.value.invitation.id}/cancel`, "POST", { expectedVersion: 1 });
    expect((await req(admin, `/api/invitations/${made.value.invitation.id}/replace`, "POST", { expectedVersion: 1, role: "reviewer" })).status).toBe(409);
  });
  it("persists onboarding exchange throttles across API instances", async () => {
    await req(recipient, "/api/onboarding");
    for (let i = 0; i < 10; i++) expect((await req(recipient, "/api/onboarding/exchange", "POST", { token: "invalid" })).status).toBe(400);
    const other = new AuthService(state, { VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: base }); await other.ready;
    expect((await req(recipient, "/api/onboarding/exchange", "POST", { token: "invalid" })).status).toBe(429);
    expect((await state.list("login-attempts")).some((row) => (row.value as { count: number }).count === 10)).toBe(true);
  });
});

describe("admission upgrades and bootstrap", () => {
  const env = { VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: "https://dashboard.example.test", VISUALGUARD_ADMIN_EMAIL: "admin@example.test", VISUALGUARD_ADMIN_PASSWORD: "test-only-password-long" };
  it("requires an explicit policy for pre-policy installations and persists the chosen policy", async () => {
    const state = new MemoryStateStore(); const initial = new AuthService(state, env); await initial.ready;
    await state.remove("admission", "current");
    await expect(new AuthService(state, env).ready).rejects.toThrow("Existing installation");
    const migrated = new AuthService(state, { ...env, VISUALGUARD_USER_ADMISSION: "legacy" }); await migrated.ready;
    expect(migrated.admission).toBe("legacy"); const reopened = new AuthService(state, env); await reopened.ready; expect(reopened.admission).toBe("legacy");
    const closed = new AuthService(state, { ...env, VISUALGUARD_USER_ADMISSION: "invite" }); await closed.ready; expect(closed.admission).toBe("invite");
  });
  it("validates admission config and never creates another bootstrap admin after setup", async () => {
    expect(() => new AuthService(new MemoryStateStore(), { ...env, VISUALGUARD_USER_ADMISSION: "public" })).toThrow("invite or legacy");
    const state = new MemoryStateStore(); await new AuthService(state, env).ready;
    await new AuthService(state, { ...env, VISUALGUARD_ADMIN_EMAIL: "different@example.test" }).ready;
    expect(await state.list("users")).toHaveLength(1);
  });
  it("preserves known legacy identity IDs and roles in invite-only mode", async () => {
    const state = new MemoryStateStore(), provider = oidcProvider(); vi.stubGlobal("fetch", provider.fetch);
    try {
      await new AuthService(state, env).ready;
      const identity = { issuer: provider.issuer, subject: "google-member", provider: "google" as const };
      const original: User = { id: legacyIdentityId(identity), email: "member@example.test", name: "Legacy member", role: "member", disabled: false, authVersion: 5, createdAt: "2025-01-01T00:00:00.000Z" };
      await state.create("users", original.id, original);
      const auth = new AuthService(state, { ...env, VISUALGUARD_ADMIN_EMAIL: original.email, VISUALGUARD_USER_ADMISSION: "invite", VISUALGUARD_OIDC_ISSUER: provider.issuer, VISUALGUARD_OIDC_CLIENT_ID: provider.clientId, VISUALGUARD_OIDC_CLIENT_SECRET: provider.clientSecret }); await auth.ready;
      const headers = new Map<string, string>();
      const response = { setHeader: (k: string, v: string) => headers.set(k, v), writeHead: (_status: number, value: Record<string, string>) => { for (const [k, v] of Object.entries(value)) headers.set(k, v); }, end() {} } as unknown as ServerResponse;
      await auth.beginOidc(response); const target = new URL(headers.get("Location")!), cookie = headers.get("Set-Cookie")!.split(";")[0]!;
      const callback = new URL(`${env.VISUALGUARD_PUBLIC_URL}/api/auth/callback?code=${provider.authorize(target)}&state=${target.searchParams.get("state")}`);
      await auth.finishOidc({ headers: { cookie } } as IncomingMessage, response, callback);
      expect((await new Identities(state).known(identity))?.id).toBe(original.id);
      expect((await state.get<User>("users", original.id))!.value).toEqual(original);
    } finally { vi.unstubAllGlobals(); }
  });
  it.skipIf(!process.env.VISUALGUARD_TEST_MONGODB_STANDALONE_URL)("keeps standalone Mongo legacy login available and fails before partial invitation grants", async () => {
    const target = new URL(process.env.VISUALGUARD_TEST_MONGODB_STANDALONE_URL!); target.pathname = `/vg_onboarding_${randomUUID().replaceAll("-", "")}`;
    const { state, close } = await openMongo(target.href);
    try {
      await expect(new AuthService(state, { ...env, VISUALGUARD_USER_ADMISSION: "invite" }).ready).rejects.toThrow("replica set");
      const auth = new AuthService(state, { ...env, VISUALGUARD_USER_ADMISSION: "legacy" }); await auth.ready;
      expect(await new Invitations(state, {} as PlatformRepository, env.VISUALGUARD_PUBLIC_URL).available()).toBe(false);
      expect(await state.list("invitations")).toHaveLength(0); expect(await auth.users()).not.toHaveLength(0);
    } finally { await close(); }
  });
});
