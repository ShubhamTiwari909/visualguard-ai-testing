import { randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { StateRecord, StateStore } from "./storage-contracts.js";
import { oidcSettings, type OidcSettings } from "./oidc-config.js";
import type { OnboardingBinding } from "./onboarding.js";
import { Administration, touchAdministratorGuard } from "./administration.js";
import { Identities, type LinkProof } from "./identities.js";

const scrypt = promisify(deriveKey);
const SESSION_SECONDS = 12 * 60 * 60;
const expires = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const emailAddress = (value: string) => {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new PlatformError(400, "A valid email address is required");
  return email;
};
export type ProjectRole = "viewer" | "reviewer" | "maintainer";
export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  disabled: boolean;
  authVersion: number;
  passwordHash?: string;
  createdAt: string;
}
interface Session {
  userId: string;
  authVersion: number;
  csrf: string;
  authenticatedAt?: string;
  authentication?: "password" | "oidc";
}
const recentlyAuthenticated = (session: Session) => {
  const age = Date.now() - Date.parse(session.authenticatedAt ?? "");
  return session.authentication === "oidc" && Number.isFinite(age) && age >= 0 && age <= 300_000;
};
export interface Membership {
  userId: string;
  projectId: string;
  role: ProjectRole;
}
interface UploadToken {
  authVersion?: number;
  projectId: string;
  ownerId: string;
  name: string;
  createdAt: string;
}
export interface Actor {
  id: string;
  name: string;
  email: string;
  admin: boolean;
  csrf: string;
  sessionId?: string;
  uploadProject?: string;
  credentialId?: string;
}
interface OidcAttempt {
  state: string;
  nonce: string;
  verifier: string;
  link?: LinkProof;
  join?: OnboardingBinding;
}
export const safeUser = ({ passwordHash: _hash, ...user }: User) => user;
const secret = () => randomBytes(32).toString("base64url");
const matches = (left: string, right: string) => {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class AuthService {
  readonly mode: "local" | "login";
  readonly publicUrl?: URL;
  readonly ready: Promise<void>;
  admission: "invite" | "legacy" = "invite";
  readonly oidcProvider: "google" | "oidc" | null;
  private readonly oidcSettings?: OidcSettings;
  private identities: Identities;
  readonly administration: Administration;
  private localToken = secret();
  constructor(
    readonly state: StateStore,
    readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    const mode =
      env.VISUALGUARD_AUTH_MODE ??
      (env.VERCEL || env.K_SERVICE || env.VISUALGUARD_PUBLIC_URL ? "login" : "local");
    if (mode !== "local" && mode !== "login")
      throw new Error("VISUALGUARD_AUTH_MODE must be local or login");
    this.mode = mode;
    if (env.VISUALGUARD_USER_ADMISSION && !["invite", "legacy"].includes(env.VISUALGUARD_USER_ADMISSION))
      throw new Error("VISUALGUARD_USER_ADMISSION must be invite or legacy");
    if (env.VISUALGUARD_PUBLIC_URL) {
      this.publicUrl = new URL(env.VISUALGUARD_PUBLIC_URL);
      if (
        this.publicUrl.pathname !== "/" ||
        this.publicUrl.search ||
        this.publicUrl.hash ||
        !["http:", "https:"].includes(this.publicUrl.protocol)
      )
        throw new Error("VISUALGUARD_PUBLIC_URL must be an HTTP(S) origin without a path");
      if (
        mode === "local" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(this.publicUrl.hostname)
      )
        throw new Error("Local authentication cannot be exposed on a public host");
      if (
        mode === "login" &&
        this.publicUrl.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(this.publicUrl.hostname)
      )
        throw new Error("Hosted login requires HTTPS");
    }
    if (mode === "login" && !this.publicUrl)
      throw new Error("Hosted login requires VISUALGUARD_PUBLIC_URL");
    this.oidcSettings = mode === "login" ? oidcSettings(env) : undefined;
    this.oidcProvider = this.oidcSettings?.provider ?? null;
    this.identities = new Identities(state);
    this.administration = new Administration(state);
    this.ready = this.bootstrap();
  }

  private async bootstrap() {
    if (this.mode === "local") return;
    const existing = await this.state.get<{ version: number; mode: "invite" | "legacy"; bootstrapComplete: boolean }>("admission", "current");
    if (existing && (existing.value.version !== 1 || !["invite", "legacy"].includes(existing.value.mode) || typeof existing.value.bootstrapComplete !== "boolean"))
      throw new Error("Admission storage requires a compatible dashboard version");
    const installedUsers = await this.state.list<User>("users", "", 1);
    if (!existing && !this.env.VISUALGUARD_USER_ADMISSION && installedUsers.length)
      throw new Error("Existing installation: set VISUALGUARD_USER_ADMISSION=invite or legacy explicitly before upgrading");
    this.admission = this.env.VISUALGUARD_USER_ADMISSION as "invite" | "legacy" | undefined ?? existing?.value.mode ?? "invite";
    if (this.admission === "invite" && !await this.identities.available())
      throw new Error("Invitation admission requires transactional storage; use a MongoDB replica set, SQLite, or PostgreSQL, or explicitly retain VISUALGUARD_USER_ADMISSION=legacy");
    await this.state.create("admission", "current", { version: 1, mode: this.admission, bootstrapComplete: installedUsers.length > 0 });
    const policy = (await this.state.get<{ version: number; mode: string; bootstrapComplete: boolean }>("admission", "current"))!;
    if (policy.value.mode !== this.admission) {
      policy.value.mode = this.admission;
      if (!await this.state.replace("admission", policy)) throw new Error("Admission policy changed; restart dashboard");
    }
    const email = this.env.VISUALGUARD_ADMIN_EMAIL,
      password = this.env.VISUALGUARD_ADMIN_PASSWORD;
    if (email && password && !(await this.state.get<{ bootstrapComplete: boolean }>("admission", "current"))?.value.bootstrapComplete) {
      const user = await this.passwordUser({ email, password, name: "Workspace administrator", role: "admin" });
      if (await this.identities.available()) {
        await this.state.transaction!(async (store) => {
          await touchAdministratorGuard(store);
          const policy = (await store.get<{ version: number; mode: string; bootstrapComplete: boolean }>("admission", "current"))!;
          if (policy.value.bootstrapComplete) return;
          policy.value.bootstrapComplete = true;
          if (!await store.create("users", user.id, user) || !await store.replace("admission", policy))
            throw new Error("Administrator setup changed; restart dashboard");
        });
      } else {
        // Explicit legacy mode on standalone MongoDB retains single-record bootstrap.
        const policy = (await this.state.get<{ bootstrapComplete: boolean }>("admission", "current"))!;
        policy.value.bootstrapComplete = true;
        if (!await this.state.replace("admission", policy)) throw new Error("Administrator setup changed; restart dashboard");
        if (!await this.state.create("users", user.id, user)) throw new Error("Administrator setup changed; restart dashboard");
      }
    }
    const admins = (await this.state.list<User>("users", "", 10_000)).some(
      (row) => row.value.role === "admin" && !row.value.disabled,
    );
    if (admins) {
      const policy = (await this.state.get<{ version: number; mode: string; bootstrapComplete: boolean }>("admission", "current"))!;
      if (!policy.value.bootstrapComplete) {
        policy.value.bootstrapComplete = true;
        if (!await this.state.replace("admission", policy)) throw new Error("Administrator setup changed; restart dashboard");
      }
    }
    if (
      !admins &&
      !(
        this.oidcSettings &&
        (this.env.VISUALGUARD_ADMIN_EMAIL || this.env.VISUALGUARD_OIDC_ADMIN_SUBJECTS)
      )
    )
      throw new Error(
        "Configure VISUALGUARD_ADMIN_EMAIL and VISUALGUARD_ADMIN_PASSWORD (12+ characters), or an OIDC administrator",
      );
  }

  url(request: IncomingMessage): URL {
    const host = request.headers.host ?? "localhost";
    let url: URL;
    try {
      url = new URL(request.url ?? "/", this.publicUrl?.origin ?? `http://${host}`);
    } catch {
      throw new PlatformError(400, "Invalid request URL");
    }
    if (this.publicUrl) {
      if (host !== this.publicUrl.host || url.origin !== this.publicUrl.origin)
        throw new PlatformError(403, "Use the configured dashboard URL");
    } else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new PlatformError(403, "Local workspace access is restricted to loopback hosts");
    if (request.headers.origin && request.headers.origin !== url.origin)
      throw new PlatformError(403, "Cross-origin API access is not allowed");
    return url;
  }

  async actor(request: IncomingMessage): Promise<Actor | undefined> {
    await this.ready;
    if (this.mode === "local")
      return {
        id: "local-owner",
        name: "Local workspace",
        email: "",
        admin: true,
        csrf: this.localToken,
      };
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const id = sha256(authorization.slice(7));
      const entry = await this.state.get<UploadToken>("tokens", id);
      if (!entry) return undefined;
      const owner = await this.state.get<User>("users", entry.value.ownerId);
      if (!owner || owner.value.disabled || (entry.value.authVersion !== undefined && entry.value.authVersion !== owner.value.authVersion)) return undefined;
      const actor: Actor = {
        id: owner.value.id,
        name: owner.value.name,
        email: owner.value.email,
        admin: false,
        csrf: "",
        uploadProject: entry.value.projectId,
        credentialId: id,
      };
      if (
        !owner.value.role ||
        (owner.value.role !== "admin" &&
          !(await this.hasRole(
            { ...actor, uploadProject: undefined, credentialId: undefined },
            entry.value.projectId,
            "maintainer",
          )))
      )
        return undefined;
      return actor;
    }
    const token = request.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("vg_session="))
      ?.slice("vg_session=".length);
    if (!token || token.length > 200) return undefined;
    const sessionId = sha256(token),
      session = await this.state.get<Session>("sessions", sessionId);
    if (!session) return undefined;
    const user = await this.state.get<User>("users", session.value.userId);
    if (!user || user.value.disabled || user.value.authVersion !== session.value.authVersion)
      return undefined;
    return {
      id: user.value.id,
      name: user.value.name,
      email: user.value.email,
      admin: user.value.role === "admin",
      csrf: session.value.csrf,
      sessionId,
    };
  }

  csrf(request: IncomingMessage, actor: Actor) {
    if (actor.credentialId) return;
    if (!matches(String(request.headers["x-visualguard-platform-token"] ?? ""), actor.csrf))
      throw new PlatformError(403, "Missing or invalid action token");
  }
  async projectIds(actor: Actor): Promise<string[] | undefined> {
    if (actor.credentialId) return [];
    if (actor.admin) return undefined;
    return (await this.state.list<Membership>("memberships", `${actor.id}:`, 10_000)).map(
      (row) => row.value.projectId,
    );
  }
  async projectAccess(actor: Actor): Promise<Membership[] | undefined> {
    if (actor.admin && !actor.credentialId) return undefined;
    return (await this.state.list<Membership>("memberships", `${actor.id}:`, 10_000)).map(
      (row) => row.value,
    );
  }
  async hasRole(actor: Actor, projectId: string, minimum: ProjectRole): Promise<boolean> {
    if (actor.credentialId) return false;
    if (actor.admin) return true;
    const membership = await this.state.get<Membership>("memberships", `${actor.id}:${projectId}`);
    const roles: ProjectRole[] = ["viewer", "reviewer", "maintainer"];
    return Boolean(membership && roles.indexOf(membership.value.role) >= roles.indexOf(minimum));
  }
  async requireRole(actor: Actor, projectId: string, minimum: ProjectRole = "viewer") {
    if (!(await this.hasRole(actor, projectId, minimum)))
      throw new PlatformError(403, "You do not have access to this project or action");
  }
  private async passwordUser(input: {
    email: string;
    password: string;
    name: string;
    role?: "admin" | "member";
  }) {
    const email = emailAddress(input.email);
    if (input.password.length < 12 || input.password.length > 256)
      throw new PlatformError(400, "Password must contain 12–256 characters");
    if (!input.name.trim() || input.name.length > 120)
      throw new PlatformError(400, "Name must contain 1–120 characters");
    const salt = secret(),
      hash = (await scrypt(input.password, salt, 64)) as Buffer;
    const user: User = {
      id: `password-${sha256(email)}`,
      email,
      name: input.name.trim(),
      role: input.role ?? "member",
      disabled: false,
      authVersion: 1,
      passwordHash: `scrypt$${salt}$${hash.toString("hex")}`,
      createdAt: new Date().toISOString(),
    };
    return user;
  }
  async createUser(input: { email: string; password: string; name: string; role?: "admin" | "member" }) {
    const user = await this.passwordUser(input);
    const save = async (store: StateStore) => {
      if (user.role === "admin") await touchAdministratorGuard(store);
      if (!await store.create("users", user.id, user)) throw new PlatformError(409, "An account with this email already exists");
    };
    if (user.role === "admin" && await this.administration.available()) await this.state.transaction!(save);
    else if (!await this.state.create("users", user.id, user)) throw new PlatformError(409, "An account with this email already exists");
    return safeUser(user);
  }
  async createManagedUser(actor: Actor, input: { email: string; password: string; name: string; role?: "admin" | "member" }) {
    if (this.mode === "local") return this.createUser(input);
    if (input.role === "admin") throw new PlatformError(400, "Create a member first, then explicitly promote that account");
    return this.administration.createMember(actor, await this.passwordUser({ ...input, role: "member" }));
  }
  async users() {
    return (await this.state.list<User>("users", "", 10_000)).map((row) => safeUser(row.value));
  }
  async updateUser(actor: Actor, id: string, input: { expectedVersion: number; disabled?: boolean; role?: "admin" | "member"; password?: string; currentPassword?: string; revoke?: boolean }) {
    if (!actor.admin || actor.credentialId || this.mode !== "login") throw new PlatformError(403, "Administrator access required");
    const proof = await this.proveAccount(actor, input.currentPassword);
    let passwordHash: string | undefined;
    if (input.password !== undefined) {
      if (input.password.length < 12 || input.password.length > 256) throw new PlatformError(400, "Password must contain 12–256 characters");
      const salt = secret(), hash = (await scrypt(input.password, salt, 64)) as Buffer;
      passwordHash = `scrypt$${salt}$${hash.toString("hex")}`;
    }
    return this.administration.change(actor, id, { expectedVersion: input.expectedVersion, disabled: input.disabled, role: input.role, passwordHash, revoke: input.revoke },
      { userId: proof.userId, sessionId: proof.sessionId!, authVersion: proof.authVersion, provedAt: proof.provedAt });
  }

  async throttle(id: string, limit = 10) {
    for (let retry = 0; retry < 10; retry++) {
      const row = await this.state.get<{ count: number }>("login-attempts", id);
      if (!row) {
        if (await this.state.create("login-attempts", id, { count: 1 }, expires(600))) return;
      } else {
        if (row.value.count >= limit)
          throw new PlatformError(429, "Too many login attempts; try again in ten minutes");
        row.value.count++;
        if (await this.state.replace("login-attempts", row)) return;
      }
    }
    throw new PlatformError(429, "Login is busy; retry shortly");
  }
  async login(emailValue: string, password: string, response: ServerResponse) {
    if (this.mode !== "login")
      throw new PlatformError(400, "Local workspace does not require login");
    const email = emailAddress(emailValue),
      key = sha256(email);
    await this.throttle(key);
    const row = await this.state.get<User>("users", `password-${key}`);
    const [, salt, expected] = row?.value.passwordHash?.split("$") ?? [
      "scrypt",
      "unknown-account",
      "0".repeat(128),
    ];
    const actual = (await scrypt(password.slice(0, 257), salt!, 64)) as Buffer;
    if (!row || row.value.disabled || !expected || !matches(actual.toString("hex"), expected))
      throw new PlatformError(401, "Email or password is incorrect");
    await this.state.remove("login-attempts", key);
    await this.issueSession(row.value, response, "password");
    await this.audit({ id: row.value.id }, "user.login", {});
    return safeUser(row.value);
  }
  async issueSession(user: User, response: ServerResponse, authentication: "password" | "oidc") {
    // Cookies carry a one-way-derived opaque handle, never the raw generated secret.
    // Persist a second hash for lookup so a database dump cannot replay the cookie.
    const token = sha256(secret());
    if (!await this.state.create<Session>(
      "sessions",
      sha256(token),
      { userId: user.id, authVersion: user.authVersion, csrf: secret(), authenticatedAt: new Date().toISOString(), authentication },
      expires(SESSION_SECONDS),
    )) throw new PlatformError(503, "Unable to issue a session; sign in again or retry acceptance");
    response.setHeader(
      "Set-Cookie",
      `vg_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${this.publicUrl?.protocol === "https:" ? "; Secure" : ""}`,
    );
  }
  async logout(actor: Actor, response: ServerResponse) {
    if (actor.sessionId) await this.state.remove("sessions", actor.sessionId);
    response.setHeader(
      "Set-Cookie",
      `vg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.publicUrl?.protocol === "https:" ? "; Secure" : ""}`,
    );
  }
  async changePassword(actor: Actor, current: string, password: string, response: ServerResponse) {
    if (actor.credentialId) throw new PlatformError(403, "Browser account required");
    const row = await this.state.get<User>("users", actor.id);
    if (!row?.value.passwordHash)
      throw new PlatformError(
        400,
        "Manage your company-login password through your identity provider",
      );
    if (password.length < 12 || password.length > 256)
      throw new PlatformError(400, "Password must contain 12–256 characters");
    await this.throttle(sha256(`password-change:${actor.id}`));
    const [, salt, expected] = row.value.passwordHash.split("$");
    const actual = (await scrypt(current.slice(0, 257), salt!, 64)) as Buffer;
    if (!expected || !matches(actual.toString("hex"), expected))
      throw new PlatformError(401, "Current password is incorrect");
    const nextSalt = secret(),
      nextHash = (await scrypt(password, nextSalt, 64)) as Buffer;
    row.value.passwordHash = `scrypt$${nextSalt}$${nextHash.toString("hex")}`;
    row.value.authVersion++;
    if (!(await this.state.replace("users", row)))
      throw new PlatformError(409, "Account changed; sign in again");
    await this.issueSession(row.value, response, "password");
    await this.audit(actor, "password.changed", {});
  }
  async assign(actor: Actor, projectId: string, userId: string, role: ProjectRole | null) {
    await this.requireRole(actor, projectId, "maintainer");
    const account = await this.state.get<User>("users", userId);
    if (!account) throw new PlatformError(404, "Account not found");
    if (role && account.value.disabled) throw new PlatformError(400, "Restore this account before granting new project access");
    const id = `${userId}:${projectId}`,
      row = await this.state.get<Membership>("memberships", id);
    if (!role) await this.state.remove("memberships", id);
    else if (row) {
      row.value.role = role;
      if (!(await this.state.replace("memberships", row)))
        throw new PlatformError(409, "Membership changed; retry");
    } else if (
      !(await this.state.create<Membership>("memberships", id, { userId, projectId, role }))
    )
      throw new PlatformError(409, "Membership changed; retry");
    await this.audit(actor, "membership.changed", { projectId, userId, role });
  }
  async members(projectId: string) {
    return (await this.state.list<Membership>("memberships", "", 10_000))
      .map((row) => row.value)
      .filter((row) => row.projectId === projectId);
  }
  async mintToken(actor: Actor, projectId: string, name: string, days: number) {
    await this.requireRole(actor, projectId, "maintainer");
    if (!name.trim() || name.length > 120 || !Number.isInteger(days) || days < 1 || days > 90)
      throw new PlatformError(400, "Use a token name and expiry of 1–90 days");
    let ownerVersion: number | undefined;
    if (this.mode === "login") {
      const owner = await this.state.get<User>("users", actor.id);
      const session = actor.sessionId ? await this.state.get<Session>("sessions", actor.sessionId) : undefined;
      if (!owner || owner.value.disabled || !session || session.value.userId !== actor.id || session.value.authVersion !== owner.value.authVersion)
        throw new PlatformError(401, "Sign in again before creating upload credentials");
      ownerVersion = owner.value.authVersion;
    }
    const token = `vg_upload_${secret()}`,
      id = sha256(token),
      expiresAt = expires(days * 86400);
    if (!await this.state.create<UploadToken>(
      "tokens",
      id,
      { ownerId: actor.id, projectId, name, createdAt: new Date().toISOString(), ...(ownerVersion === undefined ? {} : { authVersion: ownerVersion }) },
      expiresAt,
    )) throw new PlatformError(409, "Unable to create upload credential; retry");
    await this.audit(actor, "upload-token.created", { projectId, tokenId: id });
    return { id, token, expiresAt };
  }
  async tokens(projectId: string) {
    return (await this.state.list<UploadToken>("tokens", "", 10_000))
      .filter((row) => row.value.projectId === projectId)
      .map((row) => ({ id: row.id, name: row.value.name, expiresAt: row.expiresAt }));
  }
  async revokeToken(actor: Actor, projectId: string, id: string) {
    await this.requireRole(actor, projectId, "maintainer");
    const row = await this.state.get<UploadToken>("tokens", id);
    if (!row || row.value.projectId !== projectId) throw new PlatformError(404, "Token not found");
    await this.state.remove("tokens", id);
    await this.audit(actor, "upload-token.revoked", { projectId, tokenId: id });
  }
  async audit(actor: Pick<Actor, "id">, action: string, details: Record<string, unknown>) {
    const id = `${String(9_999_999_999_999 - Date.now()).padStart(13, "0")}:${randomUUID()}`;
    await this.state.create(
      "audit",
      id,
      { actorId: actor.id, action, details, at: new Date().toISOString() },
      expires(90 * 86400),
    );
  }

  private oidcConfiguration?: Promise<import("openid-client").Configuration>;
  private oidc() {
    const settings = this.oidcSettings;
    if (!settings)
      throw new PlatformError(400, "Single sign-on is not configured");
    this.oidcConfiguration ??= import("openid-client").then(async (client) => {
      const config = await client.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret);
      if (settings.provider === "google") client.enableNonRepudiationChecks(config);
      return config;
    }).catch((error) => {
      // A transient provider outage must not poison discovery until the next restart.
      this.oidcConfiguration = undefined;
      throw error;
    });
    return this.oidcConfiguration;
  }
  private async authorizeOidc(response: ServerResponse, link?: LinkProof, join?: OnboardingBinding) {
    const client = await import("openid-client"),
      config = await this.oidc();
    const verifier = client.randomPKCECodeVerifier(),
      state = client.randomState(),
      nonce = secret(),
      browser = sha256(secret());
    if (!await this.state.create<OidcAttempt>("oidc", sha256(browser), { state, nonce, verifier, ...(link ? { link } : {}), ...(join ? { join } : {}) }, expires(600)))
      throw new PlatformError(409, "Unable to start sign-in; retry");
    const target = client.buildAuthorizationUrl(config, {
      redirect_uri: `${this.publicUrl!.origin}/api/auth/callback`,
      scope: "openid email profile",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
      ...((link || join) ? { prompt: "select_account" } : {}),
    });
    response.setHeader(
      "Set-Cookie",
      `vg_oidc=${browser}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${this.publicUrl?.protocol === "https:" ? "; Secure" : ""}`,
    );
    return target;
  }
  async beginOidc(response: ServerResponse) {
    const target = await this.authorizeOidc(response);
    response.writeHead(302, { Location: target.href });
    response.end();
  }
  private browserAccount(actor: Actor) {
    if (this.mode !== "login" || actor.credentialId || !actor.sessionId)
      throw new PlatformError(403, "A signed-in browser account is required");
  }
  async accountIdentities(actor: Actor) {
    this.browserAccount(actor);
    const user = await this.state.get<User>("users", actor.id);
    const session = await this.state.get<Session>("sessions", actor.sessionId!);
    if (!user || user.value.disabled || !session || session.value.userId !== actor.id || session.value.authVersion !== user.value.authVersion)
      throw new PlatformError(401, "Sign in again");
    return {
      googleLinked: await this.identities.googleLinked(actor.id),
      googleConfigured: this.oidcProvider === "google",
      linkingAvailable: await this.identities.available(),
      requiresPassword: Boolean(user.value.passwordHash),
      reauthenticationRequired: !user.value.passwordHash && !recentlyAuthenticated(session.value),
    };
  }
  async beginGoogleLink(actor: Actor, password: string | undefined, response: ServerResponse) {
    this.browserAccount(actor);
    if (this.oidcProvider !== "google") throw new PlatformError(400, "Configure Google sign-in before linking an account");
    if (!await this.identities.available())
      throw new PlatformError(503, "Account linking requires transactional storage; use SQLite, PostgreSQL, or a MongoDB replica set");
    const user = await this.state.get<User>("users", actor.id);
    const session = await this.state.get<Session>("sessions", actor.sessionId!);
    if (!user || user.value.disabled || !session || session.value.userId !== actor.id || session.value.authVersion !== user.value.authVersion)
      throw new PlatformError(401, "Sign in again before linking Google");
    if (user.value.passwordHash) {
      await this.throttle(sha256(`identity-link:${actor.id}`));
      const [, salt, expected] = user.value.passwordHash.split("$");
      const actual = (await scrypt((password ?? "").slice(0, 257), salt!, 64)) as Buffer;
      if (!expected || !matches(actual.toString("hex"), expected)) throw new PlatformError(401, "Current password is incorrect");
    } else if (!recentlyAuthenticated(session.value)) {
      throw new PlatformError(401, "Sign in again before linking Google");
    }
    const target = await this.authorizeOidc(response, { userId: actor.id, sessionId: actor.sessionId!, authVersion: user.value.authVersion });
    return { authorizationUrl: target.href };
  }
  async beginInvitationOidc(response: ServerResponse, join: OnboardingBinding) {
    return { authorizationUrl: (await this.authorizeOidc(response, undefined, join)).href };
  }
  async proveAccount(actor: Actor, password?: string) {
    this.browserAccount(actor);
    const user = await this.state.get<User>("users", actor.id), session = await this.state.get<Session>("sessions", actor.sessionId!);
    if (!user || user.value.disabled || !session || session.value.userId !== actor.id || session.value.authVersion !== user.value.authVersion)
      throw new PlatformError(401, "Sign in again");
    if (user.value.passwordHash) {
      const attemptKey = sha256(`account-proof:${actor.id}`);
      await this.throttle(attemptKey);
      const [, salt, expected] = user.value.passwordHash.split("$");
      const actual = (await scrypt((password ?? "").slice(0, 257), salt!, 64)) as Buffer;
      if (!expected || !matches(actual.toString("hex"), expected)) throw new PlatformError(401, "Current password is incorrect");
      await this.state.remove("login-attempts", attemptKey);
    } else if (!recentlyAuthenticated(session.value)) throw new PlatformError(401, "Sign in again to verify your account");
    return { email: user.value.email, name: user.value.name, userId: user.value.id, authVersion: user.value.authVersion,
      sessionId: actor.sessionId, provedAt: new Date().toISOString() };
  }
  async finishOidc(request: IncomingMessage, response: ServerResponse, url: URL, completeJoin?: (binding: OnboardingBinding, identity: import("./identities.js").ExternalIdentity, profile: { email: string; name: string }) => Promise<void>) {
    const browser = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("vg_oidc="))
      ?.slice(8);
    const entry = browser
      ? await this.state.get<OidcAttempt>(
          "oidc",
          sha256(browser),
        )
      : undefined;
    if (!entry || !(await this.state.remove("oidc", entry.id, entry.version)))
      throw new PlatformError(401, "Login expired; start again");
    const client = await import("openid-client");
    const tokens = await client.authorizationCodeGrant(await this.oidc(), url, {
      pkceCodeVerifier: entry.value.verifier,
      expectedState: entry.value.state,
      expectedNonce: entry.value.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new PlatformError(401, "Identity provider did not return a subject");
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (this.oidcProvider === "google" && (claims.email_verified !== true || !email))
      throw new PlatformError(401, "Google did not return a verified email address");
    const identity = { issuer: this.oidcSettings!.issuer, subject: claims.sub, provider: this.oidcProvider! };
    if (entry.value.join) {
      if (!completeJoin || claims.email_verified !== true || !email) throw new PlatformError(401, "A verified email is required");
      await completeJoin(entry.value.join, identity, { email, name: typeof claims.name === "string" ? claims.name.slice(0, 120) : email });
      response.writeHead(302, { Location: "/invite" }); response.end(); return;
    }
    if (entry.value.link) {
      const actor = await this.actor(request);
      if (!actor || actor.credentialId || actor.id !== entry.value.link.userId || actor.sessionId !== entry.value.link.sessionId)
        throw new PlatformError(401, "Sign in again before linking Google");
      const user = await this.identities.link(identity, entry.value.link);
      await this.issueSession(user, response, "oidc");
      response.writeHead(302, { Location: "/settings?identity=linked" });
      response.end();
      return;
    }
    const admin =
      (this.env.VISUALGUARD_OIDC_ADMIN_SUBJECTS ?? "").split(",").includes(claims.sub) ||
      (claims.email_verified === true &&
        email === this.env.VISUALGUARD_ADMIN_EMAIL?.trim().toLowerCase());
    const profile = { email, name: typeof claims.name === "string" ? claims.name.slice(0, 120) : email || "Team member", role: "member" as const };
    let user = await this.identities.known(identity);
    if (user) user = await this.identities.resolve(identity, profile);
    else {
      const policy = (await this.state.get<{ version: number; mode: string; bootstrapComplete: boolean }>("admission", "current"))!;
      if (admin && !policy.value.bootstrapComplete && await this.identities.available()) {
        user = await this.state.transaction!(async (store) => {
          await touchAdministratorGuard(store);
          const current = (await store.get<typeof policy.value>("admission", "current"))!;
          if (current.value.bootstrapComplete) throw new PlatformError(403, "An invitation is required");
          if (await this.identities.known(identity, store)) throw new PlatformError(409, "Account changed; sign in again");
          const created = await this.identities.enroll(store, identity, profile);
          const row = (await store.get<User>("users", created.id))!;
          row.value.role = "admin";
          current.value.bootstrapComplete = true;
          if (!await store.replace("users", row) || !await store.replace("admission", current)) throw new PlatformError(409, "Administrator setup changed; retry");
          return row.value;
        });
      } else if (policy.value.mode === "legacy") {
        // Standalone Mongo retains its explicitly selected pilot workflow.
        const bootstrap = admin && !policy.value.bootstrapComplete;
        if (bootstrap) {
          policy.value.bootstrapComplete = true;
          if (!await this.state.replace("admission", policy)) throw new PlatformError(409, "Administrator setup changed; retry");
        }
        user = await this.identities.resolve(identity, { ...profile, role: bootstrap ? "admin" : "member" });
      } else throw new PlatformError(403, "Ask an administrator for an invitation before joining this workspace");
    }
    await this.issueSession(user, response, "oidc");
    await this.audit({ id: user.id }, "user.login", { provider: this.oidcProvider });
    response.writeHead(302, { Location: "/" });
    response.end();
  }
}

/** Only used by local in-process tests; hosted instances always receive database-backed state. */
export class MemoryStateStore implements StateStore {
  private entries = new Map<string, StateRecord>();
  private revision = 0;
  async supportsTransactions() { return true; }
  async transaction<T>(work: (store: StateStore) => Promise<T>): Promise<T> {
    const revision = this.revision;
    const transaction = new MemoryStateStore();
    transaction.entries = structuredClone(this.entries);
    const result = await work(transaction);
    if (this.revision !== revision) throw new PlatformError(409, "State changed; retry the operation");
    this.entries = transaction.entries;
    this.revision++;
    return result;
  }
  async get<T>(namespace: string, id: string): Promise<StateRecord<T> | undefined> {
    const entry = this.entries.get(`${namespace}:${id}`);
    return entry && (!entry.expiresAt || entry.expiresAt > new Date().toISOString())
      ? (structuredClone(entry) as StateRecord<T>)
      : undefined;
  }
  async create<T>(namespace: string, id: string, value: T, expiresAt?: string) {
    const prior = this.entries.get(`${namespace}:${id}`);
    if (prior && (!prior.expiresAt || prior.expiresAt > new Date().toISOString())) return false;
    this.entries.set(`${namespace}:${id}`, {
      id,
      value: structuredClone(value),
      version: 1,
      expiresAt,
    });
    this.revision++;
    return true;
  }
  async replace<T>(namespace: string, record: StateRecord<T>) {
    const prior = this.entries.get(`${namespace}:${record.id}`);
    if (!prior || prior.version !== record.version ||
      (prior.expiresAt && prior.expiresAt <= new Date().toISOString())) return false;
    this.entries.set(
      `${namespace}:${record.id}`,
      structuredClone({ ...record, version: record.version + 1 }),
    );
    this.revision++;
    return true;
  }
  async remove(namespace: string, id: string, version?: number) {
    const prior = this.entries.get(`${namespace}:${id}`);
    const removed = Boolean(
      prior &&
      (!prior.expiresAt || prior.expiresAt > new Date().toISOString()) &&
      (version === undefined || prior.version === version) &&
      this.entries.delete(`${namespace}:${id}`),
    );
    if (removed) this.revision++;
    return removed;
  }
  async list<T>(namespace: string, prefix = "", limit = 1000, after?: string) {
    const keys = [...this.entries.keys()]
      .filter((key) => key.startsWith(`${namespace}:${prefix}`) &&
        (after === undefined || key.slice(namespace.length + 1) > after) &&
        (!this.entries.get(key)!.expiresAt || this.entries.get(key)!.expiresAt! > new Date().toISOString()))
      .sort()
      .slice(0, limit);
    const rows = await Promise.all(
      keys.map((key) => this.get<T>(namespace, key.slice(namespace.length + 1))),
    );
    return rows.filter((row): row is StateRecord<T> => Boolean(row));
  }
  async pruneExpired(limit = 250) {
    let removed = 0;
    for (const [key, value] of this.entries)
      if (value.expiresAt && value.expiresAt <= new Date().toISOString() && removed < limit) {
        this.entries.delete(key);
        removed++;
      }
    if (removed) this.revision++;
    return removed;
  }
}
