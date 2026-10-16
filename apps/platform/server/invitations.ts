import { randomBytes, randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import { touchAdministratorGuard } from "./administration.js";
import { PlatformError } from "./errors.js";
import { Identities, type ExternalIdentity } from "./identities.js";
import type { Actor, Membership, ProjectRole, User } from "./auth.js";
import type { PlatformRepository, StateRecord, StateStore } from "./storage-contracts.js";

export const normalizeEmail = (value: string) => {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError(400, "A valid email address is required");
  return email;
};
export interface Invitation {
  schemaVersion: 1;
  email: string;
  projectId: string;
  role: ProjectRole;
  inviterId: string;
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
  status: "pending" | "cancelled" | "accepted";
  acceptedBy?: string;
  acceptedAt?: string;
  acceptedAuthVersion?: number;
}
export interface JoinProof {
  email: string;
  name: string;
  provedAt: string;
  identity?: ExternalIdentity;
  userId?: string;
  authVersion?: number;
  sessionId?: string;
}
export interface ProjectGuard { status: "active" | "deleting"; operation?: string }
const pendingKey = (email: string, project: string) => sha256(JSON.stringify([email, project]));
const conflict = () => new PlatformError(409, "Invitation changed; refresh and retry");
export const safeInvitation = (row: StateRecord<Invitation>) => {
  const { tokenHash: _secret, ...value } = row.value;
  return { ...value, id: row.id, version: row.version,
    status: value.status === "pending" && value.expiresAt <= new Date().toISOString() ? "expired" : value.status };
};

/** The guard is written by acceptance AND every ProjectDirectory deletion path. */
export async function touchProject(store: StateStore, id: string) {
  const guard = await store.get<ProjectGuard>("invitation-projects", id);
  if (!guard || guard.value.status !== "active") throw new PlatformError(410, "Project is unavailable");
  if (!await store.replace("invitation-projects", guard)) throw conflict();
}

export class Invitations {
  private identities: Identities;
  constructor(private state: StateStore, private repository: PlatformRepository, private origin: string) {
    this.identities = new Identities(state);
  }
  async available() { return this.identities.available(); }
  private async transaction<T>(work: (store: StateStore) => Promise<T>) {
    if (!await this.available()) throw new PlatformError(503, "Invitations require SQLite, PostgreSQL, or a MongoDB replica set");
    for (let attempt = 0; ; attempt++) {
      try { return await this.state.transaction!(async (store) => { await touchAdministratorGuard(store); return work(store); }); }
      catch (error) {
        if (!(error instanceof PlatformError && error.status === 409 && attempt < 2)) throw error;
      }
    }
  }
  async prepareProject(id: string) {
    // Initialize BEFORE reading evidence: a concurrent deletion must observe the same guard.
    await this.state.create<ProjectGuard>("invitation-projects", id, { status: "active" });
    if (!(await this.repository.projects([id])).length || await this.repository.isDeletedProject(id))
      throw new PlatformError(410, "Project is unavailable");
  }
  private async admin(store: StateStore, actor: Actor) {
    if (!actor.admin || actor.credentialId || !actor.sessionId) throw new PlatformError(403, "A signed-in administrator is required");
    const user = await store.get<User>("users", actor.id);
    const session = await store.get<{ userId: string; authVersion: number }>("sessions", actor.sessionId);
    if (!user || user.value.disabled || user.value.role !== "admin" || !session || session.value.userId !== actor.id || session.value.authVersion !== user.value.authVersion)
      throw new PlatformError(403, "Administrator access required");
    if (!await store.replace("users", user) || !await store.replace("sessions", session)) throw conflict();
  }
  private async issuer(store: StateStore, id: string) {
    const user = await store.get<User>("users", id);
    if (!user || user.value.disabled || user.value.role !== "admin") throw new PlatformError(403, "Invitation issuer is no longer eligible");
    if (!await store.replace("users", user)) throw conflict();
  }
  private async audit(store: StateStore, actorId: string, action: string, id: string, projectId: string) {
    if (!await store.create("audit", `${String(9_999_999_999_999 - Date.now()).padStart(13, "0")}:${randomUUID()}`, {
      actorId, action, details: { invitationId: id, projectId }, at: new Date().toISOString(),
    }, new Date(Date.now() + 90 * 86400_000).toISOString())) throw conflict();
  }
  private pending(row: StateRecord<Invitation> | undefined, version?: number) {
    if (!row || row.value.schemaVersion !== 1) throw new PlatformError(410, "Invitation is unavailable");
    if (version !== undefined && row.version !== version) throw conflict();
    if (row.value.status !== "pending" || row.value.expiresAt <= new Date().toISOString()) throw new PlatformError(410, "Invitation has expired or is no longer available");
    return row;
  }
  private async insert(store: StateStore, actor: Actor, input: { email: string; projectId: string; role: ProjectRole; hours?: number }) {
    const email = normalizeEmail(input.email), hours = input.hours ?? 72;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168 || !["viewer", "reviewer", "maintainer"].includes(input.role))
      throw new PlatformError(400, "Choose a project role and expiry of 1–168 hours");
    const key = pendingKey(email, input.projectId), index = await store.get<{ id: string }>("invitation-pending", key);
    if (index) {
      const previous = await store.get<Invitation>("invitations", index.value.id);
      if (previous?.value.status === "pending" && previous.value.expiresAt > new Date().toISOString())
        throw new PlatformError(409, "A pending invitation already exists for this email and project");
      if (!await store.remove("invitation-pending", key, index.version)) throw conflict();
    }
    const token = randomBytes(32).toString("base64url"), id = randomUUID();
    const value: Invitation = { schemaVersion: 1, email, projectId: input.projectId, role: input.role,
      inviterId: actor.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + hours * 3600_000).toISOString(),
      status: "pending", tokenHash: sha256(token) };
    if (!await store.create("invitation-pending", key, { id }) || !await store.create("invitations", id, value) ||
      !await store.create("invitation-secrets", value.tokenHash, { id })) throw conflict();
    await this.audit(store, actor.id, "invitation.created", id, input.projectId);
    return { invitation: safeInvitation({ id, value, version: 1 }), link: `${this.origin}/invite#token=${token}` };
  }
  async create(actor: Actor, input: { email: string; projectId: string; role: ProjectRole; hours?: number }) {
    if (!await this.available()) throw new PlatformError(503, "Invitations require SQLite, PostgreSQL, or a MongoDB replica set");
    await this.prepareProject(input.projectId);
    return this.transaction(async (store) => {
      await this.admin(store, actor); await touchProject(store, input.projectId);
      return this.insert(store, actor, input);
    });
  }
  async list(actor: Actor, after?: string) {
    if (!actor.admin || actor.credentialId || !actor.sessionId) throw new PlatformError(403, "Administrator access required");
    const rows = await this.state.list<Invitation>("invitations", "", 51, after);
    return { invitations: rows.slice(0, 50).map(safeInvitation), after: rows.length > 50 ? rows[49]!.id : undefined, available: await this.available() };
  }
  private async cancelRow(store: StateStore, row: StateRecord<Invitation>, actorId: string) {
    row.value.status = "cancelled";
    if (!await store.replace("invitations", row)) throw conflict();
    const key = pendingKey(row.value.email, row.value.projectId), index = await store.get<{ id: string }>("invitation-pending", key);
    if (index?.value.id === row.id && !await store.remove("invitation-pending", key, index.version)) throw conflict();
    await this.audit(store, actorId, "invitation.cancelled", row.id, row.value.projectId);
  }
  async change(actor: Actor, id: string, version: number, replace?: { role: ProjectRole; hours?: number }) {
    const prior = await this.state.get<Invitation>("invitations", id);
    if (replace && prior) await this.prepareProject(prior.value.projectId);
    return this.transaction(async (store) => {
      await this.admin(store, actor);
      const row = await store.get<Invitation>("invitations", id);
      if (!row || row.version !== version || row.value.status !== "pending") throw conflict();
      await this.cancelRow(store, row, actor.id);
      if (!replace) return { ok: true };
      await touchProject(store, row.value.projectId);
      return this.insert(store, actor, { ...replace, email: row.value.email, projectId: row.value.projectId });
    });
  }
  async exchange(token: string) {
    const index = /^[A-Za-z0-9_-]{43}$/.test(token) ? await this.state.get<{ id: string }>("invitation-secrets", sha256(token)) : undefined;
    const row = index ? await this.state.get<Invitation>("invitations", index.value.id) : undefined;
    if (!row || row.value.status !== "pending" || row.value.expiresAt <= new Date().toISOString())
      throw new PlatformError(400, "This invitation link is unavailable; ask an administrator for a new one");
    return { id: row.id, version: row.version };
  }
  async checkAttempt(id: string, version: number) {
    try {
      const row = this.pending(await this.state.get<Invitation>("invitations", id), version);
      await this.prepareProject(row.value.projectId);
      const guard = await this.state.get<ProjectGuard>("invitation-projects", row.value.projectId);
      const issuer = await this.state.get<User>("users", row.value.inviterId);
      if (guard?.value.status !== "active" || !issuer || issuer.value.disabled || issuer.value.role !== "admin") throw new Error("unavailable");
    } catch { throw new PlatformError(400, "This invitation link is unavailable; ask an administrator for a new one"); }
  }
  async preview(id: string, version: number, proof: JoinProof) {
    const row = this.pending(await this.state.get<Invitation>("invitations", id), version);
    if (normalizeEmail(proof.email) !== row.value.email) throw new PlatformError(403, "Use the account that received this invitation");
    await this.prepareProject(row.value.projectId);
    if ((await this.state.get<ProjectGuard>("invitation-projects", row.value.projectId))?.value.status !== "active") throw new PlatformError(410, "Project is unavailable");
    const [project] = await this.repository.projects([row.value.projectId]);
    if (!project) throw new PlatformError(410, "Project is unavailable");
    const issuer = await this.state.get<User>("users", row.value.inviterId);
    if (!issuer || issuer.value.disabled || issuer.value.role !== "admin") throw new PlatformError(410, "Invitation is no longer available");
    return { ...safeInvitation(row), projectName: project.name, inviterName: issuer.value.name };
  }
  async accept(id: string, version: number, proof: JoinProof) {
    const prior = await this.state.get<Invitation>("invitations", id);
    if (!prior) throw new PlatformError(410, "Invitation is unavailable");
    await this.prepareProject(prior.value.projectId);
    return this.transaction(async (store) => {
      const row = await store.get<Invitation>("invitations", id);
      if (!row || normalizeEmail(proof.email) !== row.value.email) throw new PlatformError(403, "Use the account that received this invitation");
      const age = Date.now() - Date.parse(proof.provedAt);
      if (!Number.isFinite(age) || age < 0 || age > 300_000) throw new PlatformError(401, "Verify your account again before accepting");
      let user: User | undefined;
      if (proof.userId) {
        const account = await store.get<User>("users", proof.userId);
        if (!account || account.value.disabled || account.value.authVersion !== proof.authVersion)
          throw new PlatformError(401, "Sign in again before accepting");
        if (proof.identity && (await this.identities.known(proof.identity, store))?.id !== account.value.id)
          throw new PlatformError(401, "Identity ownership changed; sign in again");
        if (proof.sessionId) {
          const session = await store.get<{ userId: string; authVersion: number }>("sessions", proof.sessionId);
          if (!session || session.value.userId !== account.value.id || session.value.authVersion !== account.value.authVersion || !await store.replace("sessions", session))
            throw new PlatformError(401, "Sign in again before accepting");
        }
        if (!await store.replace("users", account)) throw conflict();
        user = account.value;
      } else if (proof.identity) {
        user = await this.identities.known(proof.identity, store);
        // An unknown identity proof cannot silently become an existing account after verification.
        if (user && row.value.acceptedBy !== user.id) throw new PlatformError(409, "Account changed; verify again");
      }
      if (row.value.status === "accepted" && user && row.value.acceptedBy === user.id) {
        if (row.value.acceptedAuthVersion !== user.authVersion) throw new PlatformError(401, "Sign in again; this invitation is already consumed");
        const account = (await store.get<User>("users", user.id))!;
        if (!await store.replace("users", account)) throw conflict();
        return { user, projectId: row.value.projectId, alreadyAccepted: true, alreadyAuthorized: true };
      }
      this.pending(row, version);
      await this.issuer(store, row.value.inviterId); await touchProject(store, row.value.projectId);
      if (!user) {
        if (!proof.identity) throw new PlatformError(401, "Verify your account before accepting");
        user = await this.identities.enroll(store, proof.identity, { email: normalizeEmail(proof.email), name: proof.name });
      }
      if (proof.identity && proof.userId) {
        const linked = await this.identities.enroll(store, proof.identity, { email: normalizeEmail(proof.email), name: proof.name });
        if (linked.id !== user.id) throw new PlatformError(409, "Identity ownership changed; verify again");
      }
      const membershipId = `${user.id}:${row.value.projectId}`, membership = await store.get<Membership>("memberships", membershipId);
      const ranks = ["viewer", "reviewer", "maintainer"];
      const alreadyAuthorized = user.role === "admin" || Boolean(membership && ranks.indexOf(membership.value.role) >= ranks.indexOf(row.value.role));
      if (!alreadyAuthorized) {
        const value: Membership = { userId: user.id, projectId: row.value.projectId, role: row.value.role };
        if (!(membership ? await store.replace("memberships", { ...membership, value }) : await store.create("memberships", membershipId, value))) throw conflict();
      } else if (membership && !await store.replace("memberships", membership)) throw conflict();
      row.value.status = "accepted"; row.value.acceptedBy = user.id; row.value.acceptedAt = new Date().toISOString(); row.value.acceptedAuthVersion = user.authVersion;
      if (!await store.replace("invitations", row)) throw conflict();
      const key = pendingKey(row.value.email, row.value.projectId), index = await store.get<{ id: string }>("invitation-pending", key);
      if (!index || index.value.id !== id || !await store.remove("invitation-pending", key, index.version)) throw conflict();
      await this.audit(store, user.id, "invitation.accepted", id, row.value.projectId);
      return { user, projectId: row.value.projectId, alreadyAccepted: false, alreadyAuthorized };
    });
  }
}
