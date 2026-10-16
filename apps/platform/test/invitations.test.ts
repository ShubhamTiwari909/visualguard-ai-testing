import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStateStore, type Actor, type User, type Membership } from "../server/auth.js";
import { Invitations, type Invitation, type JoinProof } from "../server/invitations.js";
import { Identities, identityKey } from "../server/identities.js";
import { openDatabase } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";
import { Repository } from "../server/repository.js";
import { openMongo } from "../server/mongo.js";
import { sha256 } from "../server/artifacts.js";
import type { PlatformRepository, StateStore } from "../server/storage-contracts.js";

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
    `${backend} invitation transaction contract`,
    () => {
      let state: StateStore,
        repository: PlatformRepository,
        close: () => Promise<void>,
        root: string;
      beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), "vg-invites-"));
        if (backend === "memory") {
          state = new MemoryStateStore();
          close = async () => {};
          repository = {
            projects: async (ids?: string[]) => (ids ?? []).map((id) => ({ id, name: "Demo" })),
            isDeletedProject: async () => false,
          } as unknown as PlatformRepository;
        } else if (backend === "mongo") ({ state, repository, close } = await openMongo(url!));
        else {
          const db = await openDatabase({
            url: backend === "postgres" ? url : undefined,
            sqlitePath: join(root, "invitations.sqlite"),
          });
          state = new SqlStateStore(db);
          repository = new Repository(db);
          close = () => db.close();
        }
      });
      afterAll(async () => {
        await close?.();
        if (root) await rm(root, { recursive: true, force: true });
      });
      async function setup(store = state) {
        const projectId = `invite-${randomUUID()}`;
        if (backend !== "memory") await repository.createProject(projectId, "Invitation demo");
        const admin: User = {
          id: `admin-${randomUUID()}`,
          email: "admin@example.test",
          name: "Admin",
          role: "admin",
          disabled: false,
          authVersion: 1,
          createdAt: new Date().toISOString(),
        };
        const sessionId = randomUUID();
        await state.create("users", admin.id, admin);
        await state.create("sessions", sessionId, { userId: admin.id, authVersion: 1 });
        const actor: Actor = { ...admin, admin: true, csrf: "csrf", sessionId };
        const proof: JoinProof = {
          email: `recipient-${randomUUID()}@example.test`,
          name: "Recipient",
          provedAt: new Date().toISOString(),
          identity: {
            issuer: "https://accounts.google.com",
            subject: randomUUID(),
            provider: "google",
          },
        };
        const invitations = new Invitations(store, repository, "https://dashboard.example.test");
        const create = () =>
          invitations.create(actor, { email: proof.email, projectId, role: "reviewer" });
        return { actor, admin, proof, projectId, invitations, create };
      }
      it("stores only hashes, normalizes email, exposes bounded safe metadata and prevents duplicate pending creates", async () => {
        const f = await setup();
        f.proof.email = `  ${f.proof.email.toUpperCase()}  `;
        const results = await Promise.allSettled([f.create(), f.create()]);
        const success = results.find((r) => r.status === "fulfilled")!;
        expect(success.status).toBe("fulfilled");
        if (success.status !== "fulfilled") throw new Error("No winner");
        const value = success.value;
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const token = value.link.split("token=")[1]!;
        expect(Buffer.from(token, "base64url")).toHaveLength(32);
        const row = (await state.get<Invitation>("invitations", value.invitation.id))!;
        expect(row.value.tokenHash).toBe(sha256(token));
        expect(row.value.email).toBe(f.proof.email.trim().toLowerCase());
        expect(JSON.stringify(await f.invitations.list(f.actor))).not.toContain(token);
        expect(JSON.stringify(await f.invitations.list(f.actor))).not.toContain("tokenHash");
        expect(await f.invitations.exchange(token)).toEqual({ id: row.id, version: 1 });
        expect(row.value.status).toBe("pending");
        expect(await state.get("users", `user-${f.proof.identity!.subject}`)).toBeUndefined();
        expect((await f.invitations.list(f.actor)).invitations.length).toBeLessThanOrEqual(50);
      });
      it("accepts atomically, preserves a durable receipt, and never restores removed membership on replay", async () => {
        const f = await setup(),
          created = await f.create();
        const result = await f.invitations.accept(created.invitation.id, 1, f.proof);
        expect(result.user.role).toBe("member");
        expect(result.user.id).toMatch(/^user-/);
        expect(
          (await state.get<Membership>("memberships", `${result.user.id}:${f.projectId}`))!.value
            .role,
        ).toBe("reviewer");
        expect(
          (await state.get<{ userId: string }>(
            "external-identities",
            identityKey(f.proof.identity!),
          ))!.value.userId,
        ).toBe(result.user.id);
        expect(
          (await state.get<Invitation>("invitations", created.invitation.id))!.value.status,
        ).toBe("accepted");
        await state.remove("memberships", `${result.user.id}:${f.projectId}`);
        expect(
          (await f.invitations.accept(created.invitation.id, 1, f.proof)).alreadyAccepted,
        ).toBe(true);
        expect(await state.get("memberships", `${result.user.id}:${f.projectId}`)).toBeUndefined();
        await expect(
          f.invitations.exchange(created.link.split("token=")[1]!),
        ).rejects.toMatchObject({ status: 400 });
      });
      it("replaces and cancels by version, permanently invalidating the old link", async () => {
        const f = await setup(),
          first = await f.create();
        const replacement = await f.invitations.change(f.actor, first.invitation.id, 1, {
          role: "viewer",
          hours: 24,
        });
        expect("link" in replacement).toBe(true);
        await expect(f.invitations.exchange(first.link.split("token=")[1]!)).rejects.toMatchObject({
          status: 400,
        });
        await expect(f.invitations.change(f.actor, first.invitation.id, 1)).rejects.toMatchObject({
          status: 409,
        });
        if (!("invitation" in replacement)) throw new Error("Missing replacement");
        await f.invitations.change(f.actor, replacement.invitation.id, 1);
        await expect(
          f.invitations.exchange(replacement.link.split("token=")[1]!),
        ).rejects.toMatchObject({ status: 400 });
      });
      it("allows exactly one terminal transition in cancellation-versus-acceptance races", async () => {
        const f = await setup(),
          created = await f.create();
        const results = await Promise.allSettled([
          f.invitations.accept(created.invitation.id, 1, f.proof),
          f.invitations.change(f.actor, created.invitation.id, 1),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const invitation = (await state.get<Invitation>("invitations", created.invitation.id))!
          .value;
        const mapping = await state.get<{ userId: string }>(
          "external-identities",
          identityKey(f.proof.identity!),
        );
        expect(Boolean(mapping)).toBe(invitation.status === "accepted");
      });
      it.each([
        "expired",
        "wrong-email",
        "old-proof",
        "disabled-issuer",
        "demoted-issuer",
        "project-deleting",
      ])("rejects %s without any identity or membership grant", async (condition) => {
        const f = await setup(),
          created = await f.create();
        if (condition === "expired") {
          const row = (await state.get<Invitation>("invitations", created.invitation.id))!;
          row.value.expiresAt = new Date(0).toISOString();
          await state.replace("invitations", row);
        }
        if (condition === "wrong-email") f.proof.email = "wrong@example.test";
        if (condition === "old-proof")
          f.proof.provedAt = new Date(Date.now() - 301_000).toISOString();
        if (condition.endsWith("issuer")) {
          const row = (await state.get<User>("users", f.admin.id))!;
          if (condition === "disabled-issuer") row.value.disabled = true;
          else row.value.role = "member";
          await state.replace("users", row);
        }
        if (condition === "project-deleting") {
          const row = (await state.get("invitation-projects", f.projectId))!;
          await state.replace("invitation-projects", { ...row, value: { status: "deleting" } });
        }
        await expect(
          f.invitations.accept(created.invitation.id, condition === "expired" ? 2 : 1, f.proof),
        ).rejects.toThrow();
        expect(
          await state.get("external-identities", identityKey(f.proof.identity!)),
        ).toBeUndefined();
        expect(
          (await state.get<Invitation>("invitations", created.invitation.id))!.value.status,
        ).toBe("pending");
      });
      it("requires existing-account proof instead of merging matching email text", async () => {
        const f = await setup(),
          created = await f.create();
        const existing: User = {
          ...f.admin,
          id: `password-${randomUUID()}`,
          email: f.proof.email,
          role: "member",
        };
        await state.create("users", existing.id, existing);
        await expect(f.invitations.accept(created.invitation.id, 1, f.proof)).rejects.toMatchObject(
          { status: 409 },
        );
        expect(
          await state.get("external-identities", identityKey(f.proof.identity!)),
        ).toBeUndefined();
        const sessionId = randomUUID();
        await state.create("sessions", sessionId, { userId: existing.id, authVersion: 1 });
        const proof = {
          ...f.proof,
          identity: undefined,
          userId: existing.id,
          authVersion: 1,
          sessionId,
        };
        await state.create("memberships", `${existing.id}:${f.projectId}`, {
          userId: existing.id,
          projectId: f.projectId,
          role: "maintainer",
        });
        expect(
          (await f.invitations.accept(created.invitation.id, 1, proof)).alreadyAuthorized,
        ).toBe(true);
        expect(
          (await state.get<Membership>("memberships", `${existing.id}:${f.projectId}`))!.value.role,
        ).toBe("maintainer");
      });
      it.each(["disabled", "revoked-session", "auth-version"])(
        "rejects %s recipients",
        async (condition) => {
          const f = await setup(),
            created = await f.create();
          const user = await new Identities(state).resolve(f.proof.identity!, {
            email: f.proof.email,
            name: "Known",
            role: "member",
          });
          const sessionId = randomUUID();
          await state.create("sessions", sessionId, { userId: user.id, authVersion: 1 });
          const proof = { ...f.proof, userId: user.id, authVersion: 1, sessionId };
          if (condition === "revoked-session") await state.remove("sessions", sessionId);
          else {
            const row = (await state.get<User>("users", user.id))!;
            if (condition === "disabled") row.value.disabled = true;
            else row.value.authVersion++;
            await state.replace("users", row);
          }
          await expect(f.invitations.accept(created.invitation.id, 1, proof)).rejects.toMatchObject(
            { status: 401 },
          );
          expect(await state.get("memberships", `${user.id}:${f.projectId}`)).toBeUndefined();
        },
      );
      it("rolls back identity, user, membership, terminal state and pending index if the audit write fails", async () => {
        const wrapped = proxy(state),
          originalTransaction = wrapped.transaction!;
        wrapped.transaction = (work) =>
          originalTransaction((tx) => {
            const child = proxy(tx);
            child.create = async (ns, ...args) => {
              if (ns === "audit") throw new Error("injected audit failure");
              return tx.create(ns, ...args);
            };
            return work(child);
          });
        const f = await setup(),
          created = await f.create(),
          broken = new Invitations(wrapped, repository, "https://dashboard.example.test");
        await expect(broken.accept(created.invitation.id, 1, f.proof)).rejects.toThrow(
          "injected audit failure",
        );
        expect(
          await state.get("external-identities", identityKey(f.proof.identity!)),
        ).toBeUndefined();
        expect(
          (await state.get<Invitation>("invitations", created.invitation.id))!.value.status,
        ).toBe("pending");
        await expect(f.create()).rejects.toMatchObject({ status: 409 });
        await expect(
          f.invitations.accept(created.invitation.id, 1, f.proof),
        ).resolves.toHaveProperty("user");
      });
      it.skipIf(backend === "memory")(
        "serializes deletion with acceptance and leaves no orphan membership",
        async () => {
          const f = await setup(),
            created = await f.create();
          const results = await Promise.allSettled([
            f.invitations.accept(created.invitation.id, 1, f.proof),
            repository.deleteProject(f.projectId, 0),
          ]);
          const project = (await repository.projects([f.projectId]))[0];
          if (!project)
            expect(
              (await state.list<Membership>("memberships", "", 10000)).some(
                (r) => r.value.projectId === f.projectId,
              ),
            ).toBe(false);
          else {
            expect(results[1]!.status).toBe("rejected");
            await repository.deleteProject(f.projectId, 0);
          }
          await expect(f.invitations.accept(created.invitation.id, 1, f.proof)).rejects.toThrow();
        },
      );
      it.skipIf(backend !== "mongo").each(["issuer", "recipient", "session", "project"])(
        "fences a concurrent %s revocation after a Mongo snapshot read",
        async (target) => {
          const f = await setup(),
            created = await f.create();
          let injected = false;
          if (target === "recipient" || target === "session") {
            const user = await new Identities(state).resolve(f.proof.identity!, {
              email: f.proof.email,
              name: "Known",
              role: "member",
            });
            const sessionId = randomUUID();
            await state.create("sessions", sessionId, { userId: user.id, authVersion: 1 });
            Object.assign(f.proof, { userId: user.id, authVersion: 1, sessionId });
          }
          const namespace =
            target === "project"
              ? "invitation-projects"
              : target === "session"
                ? "sessions"
                : "users";
          const key =
            target === "project"
              ? f.projectId
              : target === "session"
                ? f.proof.sessionId!
                : target === "recipient"
                  ? f.proof.userId!
                  : f.admin.id;
          const wrapped = proxy(state),
            transaction = wrapped.transaction!;
          wrapped.transaction = (work) =>
            transaction((tx) => {
              const child = proxy(tx);
              child.get = async <T>(ns: string, id: string) => {
                const row = await tx.get<T>(ns, id);
                if (!injected && ns === namespace && id === key) {
                  injected = true;
                  if (target === "session") await state.remove(ns, id);
                  else {
                    const latest = (await state.get<Record<string, unknown>>(ns, id))!;
                    if (target === "project") latest.value.status = "deleting";
                    else latest.value.disabled = true;
                    await state.replace(ns, latest);
                  }
                }
                return row;
              };
              return work(child);
            });
          await expect(
            new Invitations(wrapped, repository, "https://dashboard.example.test").accept(
              created.invitation.id,
              1,
              f.proof,
            ),
          ).rejects.toThrow();
          expect(injected).toBe(true);
          expect(
            (await state.get<Invitation>("invitations", created.invitation.id))!.value.status,
          ).toBe("pending");
          if (f.proof.userId)
            expect(
              await state.get("memberships", `${f.proof.userId}:${f.projectId}`),
            ).toBeUndefined();
          else
            expect(
              await state.get("external-identities", identityKey(f.proof.identity!)),
            ).toBeUndefined();
        },
      );
    },
  );
}
