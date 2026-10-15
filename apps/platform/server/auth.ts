import { randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { StateRecord, StateStore } from "./storage-contracts.js";

const scrypt = promisify(deriveKey);
const SESSION_SECONDS = 12 * 60 * 60;
const expires = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const emailAddress = (value: string) => {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError(400, "A valid email address is required");
  return email;
};
export type ProjectRole = "viewer" | "reviewer" | "maintainer";
export interface User { id: string; email: string; name: string; role: "admin" | "member"; disabled: boolean; authVersion: number; passwordHash?: string; createdAt: string }
interface Session { userId: string; authVersion: number; csrf: string }
interface Membership { userId: string; projectId: string; role: ProjectRole }
interface UploadToken { projectId: string; ownerId: string; name: string; createdAt: string }
export interface Actor { id: string; name: string; email: string; admin: boolean; csrf: string; sessionId?: string; uploadProject?: string; credentialId?: string }
export const safeUser = ({ passwordHash: _hash, ...user }: User) => user;
const secret = () => randomBytes(32).toString("base64url");
const matches = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class AuthService {
  readonly mode: "local" | "login";
  readonly publicUrl?: URL;
  readonly ready: Promise<void>;
  private localToken = secret();
  constructor(readonly state: StateStore, readonly env: NodeJS.ProcessEnv = process.env) {
    const mode = env.VISUALGUARD_AUTH_MODE ?? (env.VERCEL || env.K_SERVICE || env.VISUALGUARD_PUBLIC_URL ? "login" : "local");
    if (mode !== "local" && mode !== "login") throw new Error("VISUALGUARD_AUTH_MODE must be local or login");
    this.mode = mode;
    if (env.VISUALGUARD_PUBLIC_URL) {
      this.publicUrl = new URL(env.VISUALGUARD_PUBLIC_URL);
      if (this.publicUrl.pathname !== "/" || this.publicUrl.search || this.publicUrl.hash || !["http:", "https:"].includes(this.publicUrl.protocol)) throw new Error("VISUALGUARD_PUBLIC_URL must be an HTTP(S) origin without a path");
      if (mode === "local" && !["localhost", "127.0.0.1", "[::1]"].includes(this.publicUrl.hostname)) throw new Error("Local authentication cannot be exposed on a public host");
      if (mode === "login" && this.publicUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(this.publicUrl.hostname)) throw new Error("Hosted login requires HTTPS");
    }
    if (mode === "login" && !this.publicUrl) throw new Error("Hosted login requires VISUALGUARD_PUBLIC_URL");
    this.ready = this.bootstrap();
  }

  private async bootstrap() {
    if (this.mode === "local") return;
    const email = this.env.VISUALGUARD_ADMIN_EMAIL, password = this.env.VISUALGUARD_ADMIN_PASSWORD;
    if (email && password) {
      const id = `password-${sha256(emailAddress(email))}`;
      if (!await this.state.get("users", id)) {
        try { await this.createUser({ email, password, name: "Workspace administrator", role: "admin" }); }
        catch (error) { if (!(error instanceof PlatformError && error.status === 409 && await this.state.get("users", id))) throw error; }
      }
    }
    const admins = (await this.state.list<User>("users", "", 10_000)).some((row) => row.value.role === "admin" && !row.value.disabled);
    if (!admins && !(this.env.VISUALGUARD_OIDC_ISSUER && (this.env.VISUALGUARD_ADMIN_EMAIL || this.env.VISUALGUARD_OIDC_ADMIN_SUBJECTS))) throw new Error("Configure VISUALGUARD_ADMIN_EMAIL and VISUALGUARD_ADMIN_PASSWORD (12+ characters), or an OIDC administrator");
  }

  url(request: IncomingMessage): URL {
    const host = request.headers.host ?? "localhost";
    let url: URL;
    try { url = new URL(request.url ?? "/", this.publicUrl?.origin ?? `http://${host}`); }
    catch { throw new PlatformError(400, "Invalid request URL"); }
    if (this.publicUrl) {
      if (host !== this.publicUrl.host || url.origin !== this.publicUrl.origin) throw new PlatformError(403, "Use the configured dashboard URL");
    } else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new PlatformError(403, "Local workspace access is restricted to loopback hosts");
    if (request.headers.origin && request.headers.origin !== url.origin) throw new PlatformError(403, "Cross-origin API access is not allowed");
    return url;
  }

  async actor(request: IncomingMessage): Promise<Actor | undefined> {
    await this.ready;
    if (this.mode === "local") return { id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: this.localToken };
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const id = sha256(authorization.slice(7));
      const entry = await this.state.get<UploadToken>("tokens", id);
      if (!entry) return undefined;
      const owner = await this.state.get<User>("users", entry.value.ownerId);
      if (!owner || owner.value.disabled) return undefined;
      const actor: Actor = { id: owner.value.id, name: owner.value.name, email: owner.value.email, admin: false, csrf: "", uploadProject: entry.value.projectId, credentialId: id };
      if (!owner.value.role || (owner.value.role !== "admin" && !await this.hasRole({ ...actor, uploadProject: undefined }, entry.value.projectId, "maintainer"))) return undefined;
      return actor;
    }
    const token = request.headers.cookie?.split(";").map((value) => value.trim()).find((value) => value.startsWith("vg_session="))?.slice("vg_session=".length);
    if (!token || token.length > 200) return undefined;
    const sessionId = sha256(token), session = await this.state.get<Session>("sessions", sessionId);
    if (!session) return undefined;
    const user = await this.state.get<User>("users", session.value.userId);
    if (!user || user.value.disabled || user.value.authVersion !== session.value.authVersion) return undefined;
    return { id: user.value.id, name: user.value.name, email: user.value.email, admin: user.value.role === "admin", csrf: session.value.csrf, sessionId };
  }

  csrf(request: IncomingMessage, actor: Actor) {
    if (actor.credentialId) return;
    if (!matches(String(request.headers["x-visualguard-platform-token"] ?? ""), actor.csrf)) throw new PlatformError(403, "Missing or invalid action token");
  }
  async projectIds(actor: Actor): Promise<string[] | undefined> {
    if (actor.credentialId) return [];
    if (actor.admin) return undefined;
    return (await this.state.list<Membership>("memberships", `${actor.id}:`, 10_000)).map((row) => row.value.projectId);
  }
  async projectAccess(actor: Actor): Promise<Membership[] | undefined> {
    if (actor.admin && !actor.credentialId) return undefined;
    return (await this.state.list<Membership>("memberships", `${actor.id}:`, 10_000)).map((row) => row.value);
  }
  async hasRole(actor: Actor, projectId: string, minimum: ProjectRole): Promise<boolean> {
    if (actor.credentialId) return false;
    if (actor.admin) return true;
    const membership = await this.state.get<Membership>("memberships", `${actor.id}:${projectId}`);
    const roles: ProjectRole[] = ["viewer", "reviewer", "maintainer"];
    return Boolean(membership && roles.indexOf(membership.value.role) >= roles.indexOf(minimum));
  }
  async requireRole(actor: Actor, projectId: string, minimum: ProjectRole = "viewer") {
    if (!await this.hasRole(actor, projectId, minimum)) throw new PlatformError(403, "You do not have access to this project or action");
  }
  async createUser(input: { email: string; password: string; name: string; role?: "admin" | "member" }) {
    const email = emailAddress(input.email);
    if (input.password.length < 12 || input.password.length > 256) throw new PlatformError(400, "Password must contain 12–256 characters");
    if (!input.name.trim() || input.name.length > 120) throw new PlatformError(400, "Name must contain 1–120 characters");
    const salt = secret(), hash = await scrypt(input.password, salt, 64) as Buffer;
    const user: User = { id: `password-${sha256(email)}`, email, name: input.name.trim(), role: input.role ?? "member", disabled: false, authVersion: 1, passwordHash: `scrypt$${salt}$${hash.toString("hex")}`, createdAt: new Date().toISOString() };
    if (!await this.state.create("users", user.id, user)) throw new PlatformError(409, "An account with this email already exists");
    return safeUser(user);
  }
  async users() { return (await this.state.list<User>("users", "", 10_000)).map((row) => safeUser(row.value)); }
  async updateUser(actor: Actor, id: string, input: { disabled?: boolean; role?: "admin" | "member"; password?: string }) {
    if (!actor.admin || actor.credentialId) throw new PlatformError(403, "Administrator access required");
    if (id === actor.id && (input.disabled || input.role === "member")) throw new PlatformError(400, "You cannot disable or demote your own administrator account");
    const row = await this.state.get<User>("users", id);
    if (!row) throw new PlatformError(404, "Account not found");
    if (input.password) {
      if (input.password.length < 12 || input.password.length > 256) throw new PlatformError(400, "Password must contain 12–256 characters");
      const salt = secret(), hash = await scrypt(input.password, salt, 64) as Buffer;
      row.value.passwordHash = `scrypt$${salt}$${hash.toString("hex")}`;
    }
    row.value = { ...row.value, disabled: input.disabled ?? row.value.disabled, role: input.role ?? row.value.role, authVersion: row.value.authVersion + 1 };
    if (!await this.state.replace("users", row)) throw new PlatformError(409, "Account changed; refresh and retry");
    await this.audit(actor, "user.updated", { userId: id });
    return safeUser(row.value);
  }

  private async throttle(id: string) {
    for (let retry = 0; retry < 10; retry++) {
      const row = await this.state.get<{ count: number }>("login-attempts", id);
      if (!row) { if (await this.state.create("login-attempts", id, { count: 1 }, expires(600))) return; }
      else {
        if (row.value.count >= 10) throw new PlatformError(429, "Too many login attempts; try again in ten minutes");
        row.value.count++;
        if (await this.state.replace("login-attempts", row)) return;
      }
    }
    throw new PlatformError(429, "Login is busy; retry shortly");
  }
  async login(emailValue: string, password: string, response: ServerResponse) {
    if (this.mode !== "login") throw new PlatformError(400, "Local workspace does not require login");
    const email = emailAddress(emailValue), key = sha256(email);
    await this.throttle(key);
    const row = await this.state.get<User>("users", `password-${key}`);
    const [, salt, expected] = row?.value.passwordHash?.split("$") ?? ["scrypt", "unknown-account", "0".repeat(128)];
    const actual = await scrypt(password.slice(0, 257), salt!, 64) as Buffer;
    if (!row || row.value.disabled || !expected || !matches(actual.toString("hex"), expected)) throw new PlatformError(401, "Email or password is incorrect");
    await this.state.remove("login-attempts", key);
    await this.issueSession(row.value, response);
    await this.audit({ id: row.value.id }, "user.login", {});
    return safeUser(row.value);
  }
  private async issueSession(user: User, response: ServerResponse) {
    const token = secret();
    await this.state.create<Session>("sessions", sha256(token), { userId: user.id, authVersion: user.authVersion, csrf: secret() }, expires(SESSION_SECONDS));
    response.setHeader("Set-Cookie", `vg_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${this.publicUrl?.protocol === "https:" ? "; Secure" : ""}`);
  }
  async logout(actor: Actor, response: ServerResponse) {
    if (actor.sessionId) await this.state.remove("sessions", actor.sessionId);
    response.setHeader("Set-Cookie", `vg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.publicUrl?.protocol === "https:" ? "; Secure" : ""}`);
  }
  async changePassword(actor: Actor, current: string, password: string, response: ServerResponse) {
    if (actor.credentialId) throw new PlatformError(403, "Browser account required");
    const row = await this.state.get<User>("users", actor.id);
    if (!row?.value.passwordHash) throw new PlatformError(400, "Manage your company-login password through your identity provider");
    if (password.length < 12 || password.length > 256) throw new PlatformError(400, "Password must contain 12–256 characters");
    await this.throttle(sha256(`password-change:${actor.id}`));
    const [, salt, expected] = row.value.passwordHash.split("$");
    const actual = await scrypt(current.slice(0, 257), salt!, 64) as Buffer;
    if (!expected || !matches(actual.toString("hex"), expected)) throw new PlatformError(401, "Current password is incorrect");
    const nextSalt = secret(), nextHash = await scrypt(password, nextSalt, 64) as Buffer;
    row.value.passwordHash = `scrypt$${nextSalt}$${nextHash.toString("hex")}`; row.value.authVersion++;
    if (!await this.state.replace("users", row)) throw new PlatformError(409, "Account changed; sign in again");
    await this.issueSession(row.value, response); await this.audit(actor, "password.changed", {});
  }
  async assign(actor: Actor, projectId: string, userId: string, role: ProjectRole | null) {
    await this.requireRole(actor, projectId, "maintainer");
    if (!await this.state.get("users", userId)) throw new PlatformError(404, "Account not found");
    const id = `${userId}:${projectId}`, row = await this.state.get<Membership>("memberships", id);
    if (!role) await this.state.remove("memberships", id);
    else if (row) { row.value.role = role; if (!await this.state.replace("memberships", row)) throw new PlatformError(409, "Membership changed; retry"); }
    else if (!await this.state.create<Membership>("memberships", id, { userId, projectId, role })) throw new PlatformError(409, "Membership changed; retry");
    await this.audit(actor, "membership.changed", { projectId, userId, role });
  }
  async members(projectId: string) { return (await this.state.list<Membership>("memberships", "", 10_000)).map((row) => row.value).filter((row) => row.projectId === projectId); }
  async mintToken(actor: Actor, projectId: string, name: string, days: number) {
    await this.requireRole(actor, projectId, "maintainer");
    if (!name.trim() || name.length > 120 || !Number.isInteger(days) || days < 1 || days > 90) throw new PlatformError(400, "Use a token name and expiry of 1–90 days");
    const token = `vg_upload_${secret()}`, id = sha256(token), expiresAt = expires(days * 86400);
    await this.state.create<UploadToken>("tokens", id, { ownerId: actor.id, projectId, name, createdAt: new Date().toISOString() }, expiresAt);
    await this.audit(actor, "upload-token.created", { projectId, tokenId: id });
    return { id, token, expiresAt };
  }
  async tokens(projectId: string) { return (await this.state.list<UploadToken>("tokens", "", 10_000)).filter((row) => row.value.projectId === projectId).map((row) => ({ id: row.id, name: row.value.name, expiresAt: row.expiresAt })); }
  async revokeToken(actor: Actor, projectId: string, id: string) {
    await this.requireRole(actor, projectId, "maintainer");
    const row = await this.state.get<UploadToken>("tokens", id);
    if (!row || row.value.projectId !== projectId) throw new PlatformError(404, "Token not found");
    await this.state.remove("tokens", id); await this.audit(actor, "upload-token.revoked", { projectId, tokenId: id });
  }
  async audit(actor: Pick<Actor, "id">, action: string, details: Record<string, unknown>) {
    const id = `${String(9_999_999_999_999 - Date.now()).padStart(13, "0")}:${randomUUID()}`;
    await this.state.create("audit", id, { actorId: actor.id, action, details, at: new Date().toISOString() }, expires(90 * 86400));
  }

  private oidcConfiguration?: Promise<import("openid-client").Configuration>;
  private oidc() {
    if (!this.env.VISUALGUARD_OIDC_ISSUER || !this.env.VISUALGUARD_OIDC_CLIENT_ID || !this.env.VISUALGUARD_OIDC_CLIENT_SECRET) throw new PlatformError(400, "Single sign-on is not configured");
    this.oidcConfiguration ??= import("openid-client").then((client) => client.discovery(new URL(this.env.VISUALGUARD_OIDC_ISSUER!), this.env.VISUALGUARD_OIDC_CLIENT_ID!, this.env.VISUALGUARD_OIDC_CLIENT_SECRET!));
    return this.oidcConfiguration;
  }
  async beginOidc(response: ServerResponse) {
    const client = await import("openid-client"), config = await this.oidc();
    const verifier = client.randomPKCECodeVerifier(), state = client.randomState(), nonce = secret(), browser = secret();
    await this.state.create("oidc", sha256(browser), { state, nonce, verifier }, expires(600));
    const target = client.buildAuthorizationUrl(config, { redirect_uri: `${this.publicUrl!.origin}/api/auth/callback`, scope: "openid email profile", code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce });
    response.setHeader("Set-Cookie", `vg_oidc=${browser}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${this.publicUrl?.protocol === "https:" ? "; Secure" : ""}`);
    response.writeHead(302, { Location: target.href }); response.end();
  }
  async finishOidc(request: IncomingMessage, response: ServerResponse, url: URL) {
    const browser = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vg_oidc="))?.slice(8);
    const entry = browser ? await this.state.get<{ state: string; nonce: string; verifier: string }>("oidc", sha256(browser)) : undefined;
    if (!entry || !await this.state.remove("oidc", entry.id, entry.version)) throw new PlatformError(401, "Login expired; start again");
    const client = await import("openid-client");
    const tokens = await client.authorizationCodeGrant(await this.oidc(), url, { pkceCodeVerifier: entry.value.verifier, expectedState: entry.value.state, expectedNonce: entry.value.nonce, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims?.sub) throw new PlatformError(401, "Identity provider did not return a subject");
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    const id = `oidc-${sha256(`${this.env.VISUALGUARD_OIDC_ISSUER}:${claims.sub}`)}`;
    const admin = (this.env.VISUALGUARD_OIDC_ADMIN_SUBJECTS ?? "").split(",").includes(claims.sub) || (claims.email_verified === true && email === this.env.VISUALGUARD_ADMIN_EMAIL?.trim().toLowerCase());
    await this.state.create<User>("users", id, { id, email, name: typeof claims.name === "string" ? claims.name.slice(0, 120) : email || "Team member", role: admin ? "admin" : "member", disabled: false, authVersion: 1, createdAt: new Date().toISOString() });
    const user = (await this.state.get<User>("users", id))!.value;
    if (user.disabled) throw new PlatformError(403, "Account is disabled");
    await this.issueSession(user, response); await this.audit({ id }, "user.login", { provider: "oidc" });
    response.writeHead(302, { Location: "/" }); response.end();
  }
}

/** Only used by local in-process tests; hosted instances always receive database-backed state. */
export class MemoryStateStore implements StateStore {
  private entries = new Map<string, StateRecord>();
  async get<T>(namespace: string, id: string): Promise<StateRecord<T> | undefined> {
    const entry = this.entries.get(`${namespace}:${id}`);
    return entry && (!entry.expiresAt || entry.expiresAt > new Date().toISOString()) ? structuredClone(entry) as StateRecord<T> : undefined;
  }
  async create<T>(namespace: string, id: string, value: T, expiresAt?: string) { if (await this.get(namespace, id)) return false; this.entries.set(`${namespace}:${id}`, { id, value: structuredClone(value), version: 1, expiresAt }); return true; }
  async replace<T>(namespace: string, record: StateRecord<T>) { const prior = await this.get(namespace, record.id); if (!prior || prior.version !== record.version) return false; this.entries.set(`${namespace}:${record.id}`, structuredClone({ ...record, version: record.version + 1 })); return true; }
  async remove(namespace: string, id: string, version?: number) { const prior = await this.get(namespace, id); return Boolean(prior && (version === undefined || prior.version === version) && this.entries.delete(`${namespace}:${id}`)); }
  async list<T>(namespace: string, prefix = "", limit = 1000) { const keys = [...this.entries.keys()].filter((key) => key.startsWith(`${namespace}:${prefix}`)).sort().slice(0, limit); const rows = await Promise.all(keys.map((key) => this.get<T>(namespace, key.slice(namespace.length + 1)))); return rows.filter((row): row is StateRecord<T> => Boolean(row)); }
  async pruneExpired(limit = 250) { let removed = 0; for (const [key, value] of this.entries) if (value.expiresAt && value.expiresAt <= new Date().toISOString() && removed < limit) { this.entries.delete(key); removed++; } return removed; }
}
