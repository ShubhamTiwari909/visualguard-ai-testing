import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService, MemoryStateStore, type User } from "../server/auth.js";
import { sha256 } from "../server/artifacts.js";
import type { ArtifactStore } from "../server/artifacts.js";
import type { PlatformRepository } from "../server/storage-contracts.js";
import { createApi } from "../server/http.js";
import { oidcSettings } from "../server/oidc-config.js";
import { oidcProvider } from "./fixtures/oidc-provider.js";
import { openDatabase } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";

function response() {
  const headers = new Map<string, string>();
  const value = {
    setHeader(name: string, content: string) {
      headers.set(name, content);
    },
    writeHead(_status: number, values: Record<string, string>) {
      for (const [name, content] of Object.entries(values)) headers.set(name, content);
    },
    end() {},
  } as unknown as ServerResponse;
  return { value, headers };
}

describe("P01 Google sign-in", () => {
  let provider: ReturnType<typeof oidcProvider>, state: MemoryStateStore, auth: AuthService;
  let env: NodeJS.ProcessEnv;
  let server: Server | undefined;
  beforeEach(async () => {
    provider = oidcProvider();
    vi.stubGlobal("fetch", provider.fetch);
    state = new MemoryStateStore();
    env = {
      VISUALGUARD_AUTH_MODE: "login",
      VISUALGUARD_PUBLIC_URL: "https://dashboard.example.test",
      VISUALGUARD_OIDC_ISSUER: provider.issuer,
      VISUALGUARD_OIDC_CLIENT_ID: provider.clientId,
      VISUALGUARD_OIDC_CLIENT_SECRET: provider.clientSecret,
      VISUALGUARD_ADMIN_EMAIL: "owner@example.test",
    };
    auth = new AuthService(state, env);
    await auth.ready;
  });
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    vi.unstubAllGlobals();
  });

  async function loginAttempt(service = auth) {
    const start = response();
    await service.beginOidc(start.value);
    const target = new URL(start.headers.get("Location")!);
    const cookie = start.headers.get("Set-Cookie")!.split(";")[0]!;
    const callback = new URL(`${env.VISUALGUARD_PUBLIC_URL}/api/auth/callback`);
    callback.searchParams.set("code", provider.authorize(target));
    callback.searchParams.set("state", target.searchParams.get("state")!);
    return { target, cookie, callback, request: { headers: { cookie } } as IncomingMessage };
  }

  it("completes the real OIDC code flow with PKCE, signed claims and a server session, without granting project access", async () => {
    const attempt = await loginAttempt();
    expect(attempt.target.searchParams.get("redirect_uri")).toBe(
      `${env.VISUALGUARD_PUBLIC_URL}/api/auth/callback`,
    );
    expect(attempt.target.searchParams.get("scope")).toBe("openid email profile");
    expect(attempt.target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(attempt.target.href).not.toContain(provider.clientSecret);
    expect(attempt.target.searchParams.has("access_type")).toBe(false);
    const result = response();
    await auth.finishOidc(attempt.request, result.value, attempt.callback);
    const cookie = result.headers.get("Set-Cookie")!.split(";")[0]!;
    const actor = (await auth.actor({ headers: { cookie } } as IncomingMessage))!;
    expect(actor.id).toBe(`oidc-${sha256(`${provider.issuer}:google-member`)}`);
    expect(actor.admin).toBe(false);
    expect(await auth.hasRole(actor, "private-project", "viewer")).toBe(false);
    expect(result.headers.get("Location")).toBe("/");
    expect(provider.jwksRequests).toBe(1);
    expect(await state.list("oidc")).toHaveLength(0);
    expect(JSON.stringify(await state.list("audit"))).toContain('"provider":"google"');
    expect(JSON.stringify(await state.list("sessions"))).not.toContain("test-only-access-token");
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).rejects.toMatchObject({ status: 401 });
    expect(provider.tokenRequests).toBe(1);
  });

  it.each([
    ["issuer", { iss: "https://attacker.example.test" }],
    ["audience", { aud: "other-client" }],
    ["expiry", { exp: 1 }],
    ["subject", { sub: undefined }],
    ["nonce", { nonce: "wrong-nonce" }],
    ["verified email", { email_verified: false }],
    ["missing email", { email: undefined }],
  ] as const)("rejects invalid %s without creating users or sessions", async (_label, claims) => {
    provider.claims = claims;
    const attempt = await loginAttempt();
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).rejects.toThrow();
    expect(await state.list("users")).toHaveLength(0);
    expect(await state.list("sessions")).toHaveLength(0);
    expect(await state.list("oidc")).toHaveLength(0);
  });

  it("rejects invalid signatures even when the other token claims match", async () => {
    provider.badSignature = true;
    const attempt = await loginAttempt();
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).rejects.toThrow();
    expect(await state.list("sessions")).toHaveLength(0);
    expect(await state.list("users")).toHaveLength(0);
  });

  it("rejects incorrect state and a browser without the initiating cookie", async () => {
    const attempt = await loginAttempt();
    await expect(
      auth.finishOidc({ headers: {} } as IncomingMessage, response().value, attempt.callback),
    ).rejects.toMatchObject({ status: 401 });
    attempt.callback.searchParams.set("state", "wrong-state");
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).rejects.toThrow();
    expect(provider.tokenRequests).toBe(0);
    expect(await state.list("sessions")).toHaveLength(0);
  });

  it("rejects a login after its server-side correlation expires", async () => {
    const attempt = await loginAttempt();
    const [correlation] = await state.list("oidc");
    await state.replace("oidc", { ...correlation!, expiresAt: "2000-01-01T00:00:00.000Z" });
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).rejects.toMatchObject({ status: 401 });
    expect(provider.tokenRequests).toBe(0);
  });

  it("retries discovery after a provider outage instead of caching the failed promise", async () => {
    provider.failDiscovery = true;
    await expect(auth.beginOidc(response().value)).rejects.toThrow();
    provider.failDiscovery = false;
    await expect(loginAttempt()).resolves.toBeDefined();
    expect(provider.discoveryRequests).toBe(2);
  });

  it("preserves existing identity, role, access and revocation without email-based password-account merging", async () => {
    const passwordUser = await auth.createUser({
      email: "member@example.test",
      name: "Password user",
      password: "test-password-long-enough",
    });
    let attempt = await loginAttempt();
    await auth.finishOidc(attempt.request, response().value, attempt.callback);
    const id = `oidc-${sha256(`${provider.issuer}:google-member`)}`;
    const row = (await state.get<User>("users", id))!;
    await state.create("memberships", `${id}:private-project`, {
      userId: id,
      projectId: "private-project",
      role: "reviewer",
    });
    provider.claims = { email: "owner@example.test" };
    attempt = await loginAttempt();
    const result = response();
    await auth.finishOidc(attempt.request, result.value, attempt.callback);
    const actor = (await auth.actor({
      headers: { cookie: result.headers.get("Set-Cookie")!.split(";")[0] },
    } as IncomingMessage))!;
    expect(actor.id).toBe(id);
    expect(actor.admin).toBe(false);
    expect(await auth.hasRole(actor, "private-project", "reviewer")).toBe(true);
    expect((await state.list("users")).map((entry) => entry.id).sort()).toEqual(
      [id, passwordUser.id].sort(),
    );
    await state.replace("users", {
      ...row,
      value: { ...row.value, disabled: true, authVersion: row.value.authVersion + 1 },
    });
    expect(
      await auth.actor({
        headers: { cookie: result.headers.get("Set-Cookie")!.split(";")[0] },
      } as IncomingMessage),
    ).toBeUndefined();
    attempt = await loginAttempt();
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).rejects.toMatchObject({ status: 403 });
    expect((await state.get<User>("users", id))!.value.disabled).toBe(true);
  });

  it("supports a Google administrator bootstrap only through verified claims", async () => {
    provider.claims = { email: "OWNER@example.test" };
    const attempt = await loginAttempt();
    await auth.finishOidc(attempt.request, response().value, attempt.callback);
    expect((await state.list<User>("users"))[0]!.value.role).toBe("admin");
  });

  it("persists Google identity and sessions across reopening the SQLite database", async () => {
    const root = await mkdtemp(join(tmpdir(), "vg-google-"));
    let db = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
    try {
      let stored = new SqlStateStore(db);
      const first = new AuthService(stored, env);
      await first.ready;
      const attempt = await loginAttempt(first);
      const result = response();
      await first.finishOidc(attempt.request, result.value, attempt.callback);
      const cookie = result.headers.get("Set-Cookie")!.split(";")[0]!;
      await db.close();
      db = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
      stored = new SqlStateStore(db);
      const reopened = new AuthService(stored, env);
      await reopened.ready;
      const actor = await reopened.actor({ headers: { cookie } } as IncomingMessage);
      expect(actor?.id).toBe(`oidc-${sha256(`${provider.issuer}:google-member`)}`);
      expect(await stored.list<User>("users")).toHaveLength(1);
      expect(await reopened.hasRole(actor!, "private-project", "viewer")).toBe(false);
    } finally {
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("continues to support generic company OIDC without imposing Google-specific email requirements", async () => {
    provider = oidcProvider("https://identity.example.test");
    vi.stubGlobal("fetch", provider.fetch);
    provider.claims = { email_verified: undefined };
    env.VISUALGUARD_OIDC_ISSUER = provider.issuer;
    auth = new AuthService(state, env);
    await auth.ready;
    expect(auth.oidcProvider).toBe("oidc");
    const attempt = await loginAttempt();
    await expect(
      auth.finishOidc(attempt.request, response().value, attempt.callback),
    ).resolves.toBeUndefined();
  });

  async function httpDashboard() {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    const base = `http://127.0.0.1:${address.port}`;
    const api = createApi({} as PlatformRepository, {} as ArtifactStore, {
      state,
      env: { ...env, VISUALGUARD_PUBLIC_URL: base },
    });
    server.on("request", (request, result) => {
      void api(request, result);
    });
    return base;
  }

  it("advertises only the configured provider, keeps secrets private, and redirects failed/cancelled browser logins safely", async () => {
    const base = await httpDashboard();
    const session = await fetch(`${base}/api/session`);
    expect(session.headers.get("cache-control")).toBe("no-store");
    const data = await session.json();
    expect(data).toMatchObject({ user: null, oidc: true, oidcProvider: "google" });
    expect(JSON.stringify(data)).not.toContain(provider.clientSecret);
    const start = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
    const target = new URL(start.headers.get("location")!);
    const callback = new URL(`${base}/api/auth/callback`);
    callback.searchParams.set("state", target.searchParams.get("state")!);
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("error_description", "untrusted-provider-detail");
    const failed = await fetch(callback, {
      redirect: "manual",
      headers: { Cookie: start.headers.get("set-cookie")!.split(";")[0]! },
    });
    expect(failed.status).toBe(302);
    expect(failed.headers.get("location")).toBe("/?signin_error=oidc");
    expect(await failed.text()).not.toContain("untrusted-provider-detail");
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect(await state.list("sessions")).toHaveLength(0);
    provider.failDiscovery = true;
    // A new API instance has no cached discovery configuration.
    server!.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    const retryBase = await httpDashboard();
    const unavailable = await fetch(`${retryBase}/api/auth/login`, { redirect: "manual" });
    expect(unavailable.headers.get("location")).toBe("/?signin_error=oidc");
  });
});

describe("OIDC configuration", () => {
  const complete = {
    VISUALGUARD_OIDC_ISSUER: "https://accounts.google.com",
    VISUALGUARD_OIDC_CLIENT_ID: "client",
    VISUALGUARD_OIDC_CLIENT_SECRET: "sensitive-value",
  };
  it("disables company login when unconfigured and preserves the original issuer for existing IDs", () => {
    expect(oidcSettings({})).toBeUndefined();
    expect(
      oidcSettings({
        VISUALGUARD_OIDC_ISSUER: "",
        VISUALGUARD_OIDC_CLIENT_ID: "",
        VISUALGUARD_OIDC_CLIENT_SECRET: " ",
      }),
    ).toBeUndefined();
    expect(oidcSettings(complete)?.provider).toBe("google");
    expect(
      oidcSettings({ ...complete, VISUALGUARD_OIDC_ISSUER: "https://accounts.google.com/" })
        ?.issuer,
    ).toBe("https://accounts.google.com/");
    expect(
      oidcSettings({
        ...complete,
        VISUALGUARD_OIDC_ISSUER: "https://company.example.test/realm/team",
      })?.provider,
    ).toBe("oidc");
  });
  it.each([
    "VISUALGUARD_OIDC_ISSUER",
    "VISUALGUARD_OIDC_CLIENT_ID",
    "VISUALGUARD_OIDC_CLIENT_SECRET",
  ])("rejects missing %s without credential values", (key) => {
    expect(() => oidcSettings({ ...complete, [key]: undefined })).toThrow(key);
    expect(() => oidcSettings({ ...complete, [key]: undefined })).not.toThrow("sensitive-value");
  });
  it.each([
    "not-a-url",
    "http://identity.example.test",
    "https://name:password@identity.example.test",
    "https://identity.example.test?secret=x",
    "https://identity.example.test#fragment",
  ])("rejects an invalid issuer configuration: %s", (issuer) => {
    expect(() => oidcSettings({ ...complete, VISUALGUARD_OIDC_ISSUER: issuer })).toThrow(
      "VISUALGUARD_OIDC_ISSUER",
    );
  });
  it("does not enable OIDC or require its credentials for the offline local owner", async () => {
    const auth = new AuthService(new MemoryStateStore(), {
      VISUALGUARD_AUTH_MODE: "local",
      VISUALGUARD_OIDC_ISSUER: complete.VISUALGUARD_OIDC_ISSUER,
    });
    await auth.ready;
    expect(auth.oidcProvider).toBeNull();
    await expect(auth.beginOidc(response().value)).rejects.toMatchObject({ status: 400 });
  });
});
