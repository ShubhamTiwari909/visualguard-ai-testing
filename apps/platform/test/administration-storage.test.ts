import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Administration, type AdministratorProof } from "../server/administration.js";
import { AuthService, MemoryStateStore, type Actor, type User } from "../server/auth.js";
import { openDatabase } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";
import { isolatedStorage } from "./fixtures/isolated-storage.js";
import type { StateStore } from "../server/storage-contracts.js";

function proxy(state: StateStore): StateStore {
  return {
    get: state.get.bind(state),
    create: state.create.bind(state),
    replace: state.replace.bind(state),
    remove: state.remove.bind(state),
    list: state.list.bind(state),
    pruneExpired: state.pruneExpired.bind(state),
    supportsTransactions: state.supportsTransactions?.bind(state),
    transaction: state.transaction?.bind(state),
  };
}
for (const backend of ["memory", "sqlite", "postgres", "mongo"] as const) {
  const url =
    backend === "postgres"
      ? process.env.VISUALGUARD_TEST_DATABASE_URL
      : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf((backend === "postgres" || backend === "mongo") && !url)(
    `${backend} administrator transaction contract`,
    () => {
      let state: StateStore, close: () => Promise<void>, root: string;
      beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), "vg-administration-"));
        if (backend === "memory") {
          state = new MemoryStateStore();
          close = async () => {};
        } else if (backend === "mongo" || backend === "postgres")
          ({ state, close } = await isolatedStorage(backend, url!));
        else {
          const db = await openDatabase({
            sqlitePath: join(root, "admin.sqlite"),
          });
          state = new SqlStateStore(db);
          close = () => db.close();
        }
      });
      afterAll(async () => {
        await close?.();
        if (root) await rm(root, { recursive: true, force: true });
      });
      async function account(role: "admin" | "member" = "admin") {
        const id = `admin-test-${randomUUID()}`,
          sessionId = randomUUID();
        const user: User = {
          id,
          name: "Admin test",
          email: `${id}@example.test`,
          role,
          disabled: false,
          authVersion: 1,
          passwordHash: "test-only-hash",
          createdAt: new Date().toISOString(),
        };
        await state.create("users", id, user);
        await state.create("sessions", sessionId, {
          userId: id,
          authVersion: 1,
          authentication: "password",
          authenticatedAt: new Date().toISOString(),
        });
        const actor: Actor = {
          id,
          name: user.name,
          email: user.email,
          admin: role === "admin",
          csrf: "csrf",
          sessionId,
        };
        const proof: AdministratorProof = {
          userId: id,
          authVersion: 1,
          sessionId,
          provedAt: new Date().toISOString(),
        };
        return { user, actor, proof };
      }
      const version = async (id: string) => (await state.get<User>("users", id))!.version;
      it("disables/restores without rewriting memberships or review authors, permanently revoking owned credentials", async () => {
        const admin = await account(),
          target = await account("member"),
          other = await account("member"),
          api = new Administration(state);
        const membership = {
          userId: target.user.id,
          projectId: "history-project",
          role: "reviewer",
        };
        const event = {
          actor: { id: target.user.id, name: target.user.name },
          decision: "approved",
        };
        await state.create("memberships", `${target.user.id}:history-project`, membership);
        await state.create("admin-review-fixture", target.user.id, event);
        for (let i = 0; i < 105; i++) {
          await state.create("tokens", `${target.user.id}:${String(i).padStart(3, "0")}`, {
            ownerId: target.user.id,
          });
          await state.create("sessions", `${target.user.id}:${String(i).padStart(3, "0")}`, {
            userId: target.user.id,
            authVersion: 1,
          });
        }
        await state.create("tokens", `${other.user.id}:kept`, { ownerId: other.user.id });
        const disabled = await api.change(
          admin.actor,
          target.user.id,
          { expectedVersion: await version(target.user.id), disabled: true },
          admin.proof,
        );
        expect(disabled.disabled).toBe(true);
        expect((await state.get<User>("users", target.user.id))!.value.authVersion).toBe(2);
        expect(await state.get("sessions", target.actor.sessionId!)).toBeUndefined();
        expect(await state.list("tokens", `${target.user.id}:`)).toHaveLength(0);
        expect(await state.list("sessions", `${target.user.id}:`)).toHaveLength(0);
        expect(await state.get("tokens", `${other.user.id}:kept`)).toBeDefined();
        await api.change(
          admin.actor,
          target.user.id,
          { expectedVersion: disabled.version, disabled: false },
          admin.proof,
        );
        expect(
          (await state.get("memberships", `${target.user.id}:history-project`))!.value,
        ).toEqual(membership);
        expect((await state.get("admin-review-fixture", target.user.id))!.value).toEqual(event);
        expect(await state.list("tokens", `${target.user.id}:`)).toHaveLength(0);
      });
      it("promotes and demotes explicitly, with atomic audit and current target versions", async () => {
        const admin = await account(),
          target = await account("member"),
          api = new Administration(state);
        const promoted = await api.change(
          admin.actor,
          target.user.id,
          { expectedVersion: 1, role: "admin" },
          admin.proof,
        );
        expect(promoted.role).toBe("admin");
        expect(promoted.version).toBe(2);
        await expect(
          api.change(
            admin.actor,
            target.user.id,
            { expectedVersion: 1, role: "member" },
            admin.proof,
          ),
        ).rejects.toMatchObject({ status: 409 });
        const demoted = await api.change(
          admin.actor,
          target.user.id,
          { expectedVersion: promoted.version, role: "member" },
          admin.proof,
        );
        expect(demoted.role).toBe("member");
        const events = (
          await state.list<{ details: { userId: string }; action: string }>("audit", "", 10000)
        ).filter((r) => r.value.details.userId === target.user.id);
        expect(events).toHaveLength(2);
        expect(JSON.stringify(events)).not.toContain("test-only-hash");
      });
      it.each(["disable", "demote"])(
        "prevents self-%s without changing the administrator account",
        async (action) => {
          const admin = await account(),
            api = new Administration(state);
          await expect(
            api.change(
              admin.actor,
              admin.user.id,
              {
                expectedVersion: 1,
                ...(action === "disable" ? { disabled: true } : { role: "member" as const }),
              },
              admin.proof,
            ),
          ).rejects.toMatchObject({ status: 400 });
          expect((await state.get<User>("users", admin.user.id))!.value).toEqual(admin.user);
        },
      );
      it.each(["disable", "demote"])(
        "allows only one winner when administrators concurrently %s each other",
        async (action) => {
          const a = await account(),
            b = await account(),
            api = new Administration(state);
          const change = action === "disable" ? { disabled: true } : { role: "member" as const };
          const results = await Promise.allSettled([
            api.change(a.actor, b.user.id, { expectedVersion: 1, ...change }, a.proof),
            api.change(b.actor, a.user.id, { expectedVersion: 1, ...change }, b.proof),
          ]);
          expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
          const users = await Promise.all(
            [a, b].map((item) => state.get<User>("users", item.user.id)),
          );
          expect(users.filter((r) => !r!.value.disabled && r!.value.role === "admin")).toHaveLength(
            1,
          );
        },
      );
      it.each(["logout", "demotion", "disable", "old-proof", "switched-session", "oidc-expiry"])(
        "fails closed after %s of the acting administrator",
        async (condition) => {
          const admin = await account(),
            target = await account("member"),
            api = new Administration(state);
          if (condition === "logout") await state.remove("sessions", admin.proof.sessionId);
          if (condition === "old-proof")
            admin.proof.provedAt = new Date(Date.now() - 301000).toISOString();
          if (condition === "switched-session") admin.proof.sessionId = "another-session";
          if (["demotion", "disable", "oidc-expiry"].includes(condition)) {
            const row = (await state.get<User>("users", admin.user.id))!;
            if (condition === "demotion") row.value.role = "member";
            if (condition === "disable") row.value.disabled = true;
            if (condition === "oidc-expiry") {
              delete row.value.passwordHash;
              const session = (await state.get("sessions", admin.proof.sessionId))!;
              await state.replace("sessions", {
                ...session,
                value: {
                  userId: admin.user.id,
                  authVersion: 1,
                  authentication: "oidc",
                  authenticatedAt: new Date(Date.now() - 301000).toISOString(),
                },
              });
            }
            await state.replace("users", row);
          }
          await expect(
            api.change(
              admin.actor,
              target.user.id,
              { expectedVersion: 1, disabled: true },
              admin.proof,
            ),
          ).rejects.toThrow();
          expect((await state.get<User>("users", target.user.id))!.value.disabled).toBe(false);
          expect(await state.get("sessions", target.proof.sessionId)).toBeDefined();
        },
      );
      it("can revoke the acting administrator's own sessions without disabling the account", async () => {
        const admin = await account(),
          api = new Administration(state);
        const result = await api.change(
          admin.actor,
          admin.user.id,
          { expectedVersion: 1, revoke: true },
          admin.proof,
        );
        expect(result.role).toBe("admin");
        expect(result.disabled).toBe(false);
        expect(await state.get("sessions", admin.proof.sessionId)).toBeUndefined();
        expect((await state.get<User>("users", admin.user.id))!.value.authVersion).toBe(2);
      });
      it("rolls back changes, credential removals and guard writes when audit fails", async () => {
        const admin = await account(),
          target = await account("member"),
          wrapped = proxy(state),
          transaction = wrapped.transaction!;
        await state.create("tokens", target.user.id, { ownerId: target.user.id });
        wrapped.transaction = (work) =>
          transaction((store) => {
            const child = proxy(store);
            child.create = async (ns, ...args) => {
              if (ns === "audit") throw new Error("injected audit failure");
              return store.create(ns, ...args);
            };
            return work(child);
          });
        await expect(
          new Administration(wrapped).change(
            admin.actor,
            target.user.id,
            { expectedVersion: 1, disabled: true },
            admin.proof,
          ),
        ).rejects.toThrow("injected audit failure");
        expect((await state.get<User>("users", target.user.id))!.value).toEqual(target.user);
        expect(await state.get("tokens", target.user.id)).toBeDefined();
        expect(await state.get("sessions", target.proof.sessionId)).toBeDefined();
      });
      it.skipIf(backend !== "mongo" && backend !== "postgres").each(["actor", "session", "target"])(
        "fences a concurrent %s change after a database read",
        async (kind) => {
          const admin = await account(),
            target = await account("member"),
            wrapped = proxy(state),
            transaction = wrapped.transaction!;
          let injected = false;
          const namespace = kind === "session" ? "sessions" : "users",
            key =
              kind === "session"
                ? admin.proof.sessionId
                : kind === "actor"
                  ? admin.user.id
                  : target.user.id;
          wrapped.transaction = (work) =>
            transaction((store) => {
              const child = proxy(store);
              child.get = async <T>(ns: string, id: string) => {
                const row = await store.get<T>(ns, id);
                if (!injected && ns === namespace && id === key) {
                  injected = true;
                  if (kind === "session") await state.remove(ns, id);
                  else {
                    const latest = (await state.get<User>(ns, id))!;
                    latest.value.disabled = true;
                    latest.value.authVersion++;
                    await state.replace(ns, latest);
                  }
                }
                return row;
              };
              return work(child);
            });
          await expect(
            new Administration(wrapped).change(
              admin.actor,
              target.user.id,
              { expectedVersion: 1, role: "admin" },
              admin.proof,
            ),
          ).rejects.toThrow();
          expect(injected).toBe(true);
          expect((await state.get<User>("users", target.user.id))!.value.role).toBe("member");
        },
      );
      it("creates only member accounts through the managed creation path", async () => {
        const admin = await account(),
          target = await account("member"),
          api = new Administration(state);
        await state.remove("users", target.user.id);
        expect((await api.createMember(admin.actor, target.user)).role).toBe("member");
        await expect(
          api.createMember(admin.actor, { ...target.user, id: randomUUID(), role: "admin" }),
        ).rejects.toMatchObject({ status: 400 });
      });
    },
  );
}

describe.skipIf(!process.env.VISUALGUARD_TEST_MONGODB_STANDALONE_URL)(
  "standalone MongoDB administration compatibility",
  () => {
    it("reports read-only account administration and refuses multi-record changes before writing", async () => {
      const { state, close } = await isolatedStorage(
        "mongo",
        process.env.VISUALGUARD_TEST_MONGODB_STANDALONE_URL!,
      );
      try {
        const auth = new AuthService(state, {
          VISUALGUARD_AUTH_MODE: "login",
          VISUALGUARD_PUBLIC_URL: "https://dashboard.example.test",
          VISUALGUARD_USER_ADMISSION: "legacy",
          VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
          VISUALGUARD_ADMIN_PASSWORD: "test-only-password-long",
        });
        await auth.ready;
        expect(await auth.administration.available()).toBe(false);
        const user = (await state.list<User>("users"))[0]!;
        const actor: Actor = {
          id: user.id,
          name: "Admin",
          email: user.value.email,
          admin: true,
          csrf: "csrf",
          sessionId: "session",
        };
        const proof = {
          userId: user.id,
          authVersion: 1,
          sessionId: "session",
          provedAt: new Date().toISOString(),
        };
        await expect(
          auth.administration.change(actor, user.id, { expectedVersion: 1, revoke: true }, proof),
        ).rejects.toMatchObject({ status: 503 });
        expect((await auth.administration.directory(actor)).administrationAvailable).toBe(false);
        expect((await state.get<User>("users", user.id))!.value.authVersion).toBe(1);
      } finally {
        await close();
      }
    });
  },
);
