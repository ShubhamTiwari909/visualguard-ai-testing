import { randomUUID } from "node:crypto";
import { sha256 } from "./artifacts.js";
import { PlatformError } from "./errors.js";
import type { StateStore } from "./storage-contracts.js";
import type { User } from "./auth.js";

export interface ExternalIdentity {
  issuer: string;
  subject: string;
  provider: "google" | "oidc";
}
interface IdentityRecord extends ExternalIdentity {
  schemaVersion: 1;
  userId: string;
  linkedAt: string;
}
export interface LinkProof {
  userId: string;
  sessionId: string;
  authVersion: number;
}
export const identityKey = (identity: ExternalIdentity) => sha256(JSON.stringify([identity.issuer, identity.subject]));
export const legacyIdentityId = (identity: ExternalIdentity) => `oidc-${sha256(`${identity.issuer}:${identity.subject}`)}`;

/** Identity grants and their audit/index records commit together. No email-based merging. */
export class Identities {
  constructor(private state: StateStore) {}
  async available() {
    return Boolean(this.state.transaction) && (await this.state.supportsTransactions?.() ?? true);
  }
  private async schema(store: StateStore) {
    const row = await store.get<{ version: number }>("identity-schema", "current");
    if (row && row.value.version !== 1) throw new PlatformError(503, "Identity storage requires a compatible dashboard version");
    if (!row && !await store.create("identity-schema", "current", { version: 1 }))
      throw new PlatformError(409, "Identity storage changed; retry sign-in");
  }
  private async account(store: StateStore, userId: string) {
    const user = await store.get<User>("users", userId);
    if (!user || user.value.disabled) throw new PlatformError(403, "Account is unavailable");
    return user;
  }
  private async mapping(store: StateStore, identity: ExternalIdentity) {
    const schema = await store.get<{ version: number }>("identity-schema", "current");
    if (schema && schema.value.version !== 1) throw new PlatformError(503, "Identity storage requires a compatible dashboard version");
    const row = await store.get<IdentityRecord>("external-identities", identityKey(identity));
    if (row && (row.value.schemaVersion !== 1 || row.value.issuer !== identity.issuer || row.value.subject !== identity.subject))
      throw new PlatformError(503, "Identity storage requires a compatible dashboard version");
    return row;
  }
  private async bind(store: StateStore, identity: ExternalIdentity, userId: string) {
    const key = identityKey(identity);
    if (!await store.create<IdentityRecord>("external-identities", key, {
      ...identity, schemaVersion: 1, userId, linkedAt: new Date().toISOString(),
    })) throw new PlatformError(409, "This identity is already linked");
    if (!await store.create("user-identities", `${userId}:${key}`, { identityKey: key, provider: identity.provider }))
      throw new PlatformError(409, "Account identities changed; retry");
    if (identity.provider === "google" && !await store.create("google-identities", userId, { identityKey: key }))
      throw new PlatformError(409, "This account already has a Google identity");
  }
  private async audit(store: StateStore, userId: string, action: string, provider: string) {
    if (!await store.create("audit", `${String(9_999_999_999_999 - Date.now()).padStart(13, "0")}:${randomUUID()}`, {
      actorId: userId, action, details: { userId, provider }, at: new Date().toISOString(),
    }, new Date(Date.now() + 90 * 86400_000).toISOString()))
      throw new PlatformError(409, "Unable to record identity action");
  }
  async googleLinked(userId: string) {
    return Boolean(await this.state.get("google-identities", userId));
  }
  async resolve(identity: ExternalIdentity, profile: Pick<User, "email" | "name" | "role">): Promise<User> {
    const existing = await this.mapping(this.state, identity);
    if (existing) return (await this.account(this.state, existing.value.userId)).value;
    if (!await this.available()) {
      // Keep P01 sign-in usable on standalone MongoDB. Linking is never emulated.
      const id = legacyIdentityId(identity);
      await this.state.create<User>("users", id, { ...profile, id, disabled: false, authVersion: 1, createdAt: new Date().toISOString() });
      return (await this.account(this.state, id)).value;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.state.transaction!(async (store) => {
          await this.schema(store);
          const mapping = await this.mapping(store, identity);
          if (mapping) return (await this.account(store, mapping.value.userId)).value;
          const legacy = await store.get<User>("users", legacyIdentityId(identity));
          if (legacy?.value.disabled) throw new PlatformError(403, "Account is unavailable");
          const user: User = legacy?.value ?? { ...profile, id: `user-${randomUUID()}`, disabled: false,
            authVersion: 1, createdAt: new Date().toISOString() };
          if (legacy) {
            // Fence concurrent disable/role/password changes, including Mongo snapshot write-skew.
            if (!await store.replace("users", legacy)) throw new PlatformError(409, "Account changed; retry sign-in");
          } else if (!await store.create("users", user.id, user)) throw new PlatformError(409, "Account changed; retry sign-in");
          await this.bind(store, identity, user.id);
          await this.audit(store, user.id, legacy ? "identity.migrated" : "identity.created", identity.provider);
          return user;
        });
      } catch (error) {
        if (!(error instanceof PlatformError && error.status === 409 && attempt < 2)) throw error;
      }
    }
    throw new PlatformError(409, "Identity changed; retry sign-in");
  }
  async link(identity: ExternalIdentity, proof: LinkProof): Promise<User> {
    if (identity.provider !== "google") throw new PlatformError(400, "Google identity required");
    if (!await this.available()) throw new PlatformError(503, "Account linking requires transactional storage; use SQLite, PostgreSQL, or a MongoDB replica set");
    return this.state.transaction!(async (store) => {
      await this.schema(store);
      const user = await this.account(store, proof.userId);
      const session = await store.get<{ userId: string; authVersion: number }>("sessions", proof.sessionId);
      if (!session || session.value.userId !== proof.userId || session.value.authVersion !== proof.authVersion || user.value.authVersion !== proof.authVersion)
        throw new PlatformError(401, "Sign in again before linking Google");
      const mapping = await this.mapping(store, identity);
      const legacy = await store.get<User>("users", legacyIdentityId(identity));
      if ((mapping && mapping.value.userId !== proof.userId) || (legacy && legacy.value.id !== proof.userId))
        throw new PlatformError(409, "This Google identity already belongs to another account");
      // Both records are written, not just read, to fence concurrent logout and disable.
      if (!await store.replace("sessions", session)) throw new PlatformError(401, "Sign in again before linking Google");
      user.value.authVersion++;
      if (!await store.replace("users", user)) throw new PlatformError(409, "Account changed; sign in again");
      if (!mapping) await this.bind(store, identity, proof.userId);
      await this.audit(store, proof.userId, "identity.linked", "google");
      return user.value;
    });
  }
}
