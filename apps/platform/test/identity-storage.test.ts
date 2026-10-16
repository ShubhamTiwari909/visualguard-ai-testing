import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStateStore, type User } from "../server/auth.js";
import { Identities, identityKey, legacyIdentityId, type ExternalIdentity, type LinkProof } from "../server/identities.js";
import { openDatabase } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";
import { openMongo } from "../server/mongo.js";
import type { StateStore } from "../server/storage-contracts.js";

export function forwardingState(state: StateStore): StateStore {
  return { get: state.get.bind(state), create: state.create.bind(state), replace: state.replace.bind(state),
    remove: state.remove.bind(state), list: state.list.bind(state), pruneExpired: state.pruneExpired.bind(state),
    supportsTransactions: state.supportsTransactions?.bind(state), transaction: state.transaction?.bind(state) };
}
const identity = (): ExternalIdentity => ({ issuer: "https://accounts.google.com", subject: randomUUID(), provider: "google" });
const profile = { name: "Member", email: "same-email@example.test", role: "member" as const };

for (const backend of ["memory", "sqlite", "postgres", "mongo"] as const) {
  const url = backend === "postgres" ? process.env.VISUALGUARD_TEST_DATABASE_URL : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf((backend === "postgres" || backend === "mongo") && !url)(`${backend} transactional identity contract`, () => {
    let state: StateStore, close: () => Promise<void>, root: string;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "vg-identities-"));
      if (backend === "memory") { state = new MemoryStateStore(); close = async () => {}; }
      else if (backend === "mongo") ({ state, close } = await openMongo(url!));
      else {
        const db = await openDatabase({ url: backend === "postgres" ? url : undefined, sqlitePath: join(root, "identity.sqlite") });
        state = new SqlStateStore(db); close = () => db.close();
      }
      expect(await state.supportsTransactions!()).toBe(true);
    });
    afterAll(async () => { await close?.(); if (root) await rm(root, { recursive: true, force: true }); });

    async function account(): Promise<{ user: User; proof: LinkProof }> {
      const user: User = { ...profile, id: `password-${randomUUID()}`, disabled: false, authVersion: 1, createdAt: new Date().toISOString() };
      const sessionId = randomUUID();
      await state.create("users", user.id, user);
      await state.create("sessions", sessionId, { userId: user.id, authVersion: 1, csrf: "test-csrf" }, new Date(Date.now() + 60_000).toISOString());
      return { user, proof: { userId: user.id, sessionId, authVersion: 1 } };
    }

    it("rolls back every write when a multi-record transaction fails", async () => {
      const id = randomUUID();
      await expect(state.transaction!(async (store) => {
        await store.create("identity-rollback", id, { first: true });
        await store.create("identity-rollback", `${id}-second`, { second: true });
        throw new Error("injected failure");
      })).rejects.toThrow("injected failure");
      expect(await state.get("identity-rollback", id)).toBeUndefined();
      expect(await state.get("identity-rollback", `${id}-second`)).toBeUndefined();
    });

    it("keeps compare-and-swap atomic across competing transactions", async () => {
      const id = randomUUID(); await state.create("identity-cas", id, {});
      const row = (await state.get("identity-cas", id))!;
      const results = await Promise.allSettled([state.transaction!((store) => store.replace("identity-cas", row)), state.transaction!((store) => store.replace("identity-cas", row))]);
      expect(results.filter((result) => result.status === "fulfilled" && result.value)).toHaveLength(1);
      expect((await state.get("identity-cas", id))!.version).toBe(2);
    });

    it("creates one opaque canonical user during concurrent sign-ins and never merges by email", async () => {
      const existing = await account(), external = identity();
      const results = await Promise.all([new Identities(state).resolve(external, profile), new Identities(state).resolve(external, profile)]);
      expect(results[0]!.id).toBe(results[1]!.id);
      expect(results[0]!.id).toMatch(/^user-[a-f0-9-]{36}$/);
      expect(results[0]!.id).not.toBe(existing.user.id);
      expect(await state.get("users", legacyIdentityId(external))).toBeUndefined();
      expect((await state.get<{ userId: string }>("external-identities", identityKey(external)))!.value.userId).toBe(results[0]!.id);
      expect((await new Identities(state).resolve(external, { ...profile, role: "admin" })).role).toBe("member");
    });

    it("migrates a legacy subject to the same ID without rewriting memberships or review authors", async () => {
      const external = identity();
      const user: User = { ...profile, id: legacyIdentityId(external), disabled: false, authVersion: 7, createdAt: "2026-01-01T00:00:00.000Z" };
      await state.create("users", user.id, user);
      const membership = { userId: user.id, projectId: randomUUID(), role: "reviewer" };
      const event = { actor: { id: user.id, name: user.name }, reason: "Existing review" };
      await state.create("memberships", `${user.id}:${membership.projectId}`, membership);
      await state.create("identity-review-fixture", user.id, event);
      expect(await new Identities(state).resolve(external, { ...profile, role: "admin" })).toEqual(user);
      expect((await state.get("memberships", `${user.id}:${membership.projectId}`))!.value).toEqual(membership);
      expect((await state.get("identity-review-fixture", user.id))!.value).toEqual(event);
      expect((await state.get<User>("users", user.id))!.value.authVersion).toBe(7);
    });

    it("binds a fresh Google identity atomically to the current account and rotates its auth version", async () => {
      const { user, proof } = await account(), external = identity();
      const linked = await new Identities(state).link(external, proof);
      expect(linked.id).toBe(user.id); expect(linked.role).toBe("member"); expect(linked.authVersion).toBe(2);
      expect(await new Identities(state).googleLinked(user.id)).toBe(true);
      expect((await new Identities(state).resolve(external, { ...profile, role: "admin" })).id).toBe(user.id);
      expect((await state.get<User>("users", user.id))!.value.role).toBe("member");
      expect((await state.list<{ actorId: string; action: string }>("audit", "", 1000)).some((row) => row.value.actorId === user.id && row.value.action === "identity.linked")).toBe(true);
    });

    it("rejects identities owned by another account, including unmigrated legacy accounts", async () => {
      for (const legacy of [false, true]) {
        const { user, proof } = await account(), external = identity();
        if (legacy) await state.create<User>("users", legacyIdentityId(external), { ...user, id: legacyIdentityId(external) });
        else await new Identities(state).resolve(external, profile);
        await expect(new Identities(state).link(external, proof)).rejects.toMatchObject({ status: 409 });
        expect((await state.get<User>("users", user.id))!.value).toEqual(user);
        expect(await new Identities(state).googleLinked(user.id)).toBe(false);
      }
    });

    it("never commits a second Google identity onto an already-linked account", async () => {
      const { user, proof } = await account();
      await new Identities(state).link(identity(), proof);
      const next = identity();
      await state.create("sessions", `${proof.sessionId}-new`, { userId: user.id, authVersion: 2 });
      await expect(new Identities(state).link(next, { ...proof, sessionId: `${proof.sessionId}-new`, authVersion: 2 })).rejects.toMatchObject({ status: 409 });
      expect(await state.get("external-identities", identityKey(next))).toBeUndefined();
      expect((await state.get<User>("users", user.id))!.value.authVersion).toBe(2);
    });

    it("allows only one account to win a concurrent identity-link race", async () => {
      const first = await account(), second = await account(), external = identity();
      const results = await Promise.allSettled([new Identities(state).link(external, first.proof), new Identities(state).link(external, second.proof)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const mapping = (await state.get<{ userId: string }>("external-identities", identityKey(external)))!.value;
      const loser = mapping.userId === first.user.id ? second : first;
      expect((await state.get<User>("users", loser.user.id))!.value.authVersion).toBe(1);
      expect(await new Identities(state).googleLinked(loser.user.id)).toBe(false);
    });

    it("fails closed after logout, disable, password/role changes, or session expiry", async () => {
      for (const action of ["logout", "disable", "version", "expiry"] as const) {
        const { user, proof } = await account(), external = identity();
        if (action === "logout") await state.remove("sessions", proof.sessionId);
        else if (action === "expiry") {
          const row = (await state.get("sessions", proof.sessionId))!;
          await state.replace("sessions", { ...row, expiresAt: "2000-01-01T00:00:00.000Z" });
        } else {
          const row = (await state.get<User>("users", user.id))!;
          await state.replace("users", { ...row, value: { ...row.value, disabled: action === "disable", authVersion: 2 } });
        }
        await expect(new Identities(state).link(external, proof)).rejects.toMatchObject({ status: action === "disable" ? 403 : 401 });
        expect(await state.get("external-identities", identityKey(external))).toBeUndefined();
      }
    });

    it("rolls back identity, owner index and session/user guards if audit fails", async () => {
      const { user, proof } = await account(), external = identity();
      const failing = forwardingState(state);
      failing.transaction = (work) => state.transaction!(async (store) => {
        const inner = forwardingState(store);
        inner.create = async <T>(namespace: string, id: string, value: T, expiresAt?: string) => {
          if (namespace === "audit") throw new Error("injected audit failure");
          return store.create(namespace, id, value, expiresAt);
        };
        return work(inner);
      });
      await expect(new Identities(failing).link(external, proof)).rejects.toThrow("injected audit failure");
      expect(await state.get("external-identities", identityKey(external))).toBeUndefined();
      expect(await state.get("user-identities", `${user.id}:${identityKey(external)}`)).toBeUndefined();
      expect(await state.get("google-identities", user.id)).toBeUndefined();
      expect((await state.get<User>("users", user.id))!.value.authVersion).toBe(1);
      expect((await state.get("sessions", proof.sessionId))!.version).toBe(1);
    });

    it("rejects a dangling or future-version identity mapping instead of creating replacement access", async () => {
      const external = identity();
      await state.create("external-identities", identityKey(external), { ...external, schemaVersion: 1, userId: `missing-${randomUUID()}`, linkedAt: new Date().toISOString() });
      await expect(new Identities(state).resolve(external, profile)).rejects.toMatchObject({ status: 403 });
      const row = (await state.get<{ schemaVersion: number }>("external-identities", identityKey(external)))!;
      await state.replace("external-identities", { ...row, value: { ...row.value, schemaVersion: 99 } });
      await expect(new Identities(state).resolve(external, profile)).rejects.toMatchObject({ status: 503 });
      expect(await state.get("users", legacyIdentityId(external))).toBeUndefined();
    });

    it.skipIf(backend !== "mongo")("fences a user disabled after MongoDB snapshot reads", async () => {
      const { user, proof } = await account(), external = identity();
      let injected = false;
      const racing = forwardingState(state);
      racing.transaction = (work) => state.transaction!(async (store) => {
        const inner = forwardingState(store);
        inner.get = async <T>(namespace: string, id: string) => {
          const row = await store.get<T>(namespace, id);
          if (!injected && namespace === "sessions") {
            injected = true;
            const current = (await state.get<User>("users", user.id))!;
            await state.replace("users", { ...current, value: { ...current.value, disabled: true, authVersion: 2 } });
          }
          return row;
        };
        return work(inner);
      });
      await expect(new Identities(racing).link(external, proof)).rejects.toMatchObject({ status: 403 });
      expect(await state.get("external-identities", identityKey(external))).toBeUndefined();
      expect((await state.get<User>("users", user.id))!.value.disabled).toBe(true);
    });
  });
}

describe.skipIf(!process.env.VISUALGUARD_TEST_MONGODB_STANDALONE_URL)("standalone MongoDB identity compatibility", () => {
  let state: StateStore, close: () => Promise<void>;
  beforeAll(async () => { ({ state, close } = await openMongo(process.env.VISUALGUARD_TEST_MONGODB_STANDALONE_URL!)); });
  afterAll(async () => { await close?.(); });
  it("keeps legacy sign-in available while rejecting linking before any grants", async () => {
    expect(await state.supportsTransactions!()).toBe(false);
    const external = identity();
    const user = await new Identities(state).resolve(external, profile);
    expect(user.id).toBe(legacyIdentityId(external));
    expect(await state.get("external-identities", identityKey(external))).toBeUndefined();
    await expect(new Identities(state).link(external, { userId: user.id, sessionId: "no-session", authVersion: 1 })).rejects.toMatchObject({ status: 503 });
    expect((await state.get<User>("users", user.id))!.value.authVersion).toBe(1);
  });
});
