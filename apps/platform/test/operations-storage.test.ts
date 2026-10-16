import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Operations } from "../server/operations.js";
import { openDatabase } from "../server/database.js";
import { SqlStateStore } from "../server/state.js";
import type { User } from "../server/auth.js";
import type { StateStore } from "../server/storage-contracts.js";
import { isolatedStorage } from "./fixtures/isolated-storage.js";

for (const backend of ["sqlite", "postgres", "mongo"] as const) {
  const url =
    backend === "postgres"
      ? process.env.VISUALGUARD_TEST_DATABASE_URL
      : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf(backend !== "sqlite" && !url)(`${backend} operations recovery`, () => {
    let state: StateStore,
      close: () => Promise<void>,
      root: string;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "vg-operations-storage-"));
      if (backend !== "sqlite") ({ state, close } = await isolatedStorage(backend, url!));
      else {
        const db = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
        state = new SqlStateStore(db);
        close = () => db.close();
      }
    });
    afterAll(async () => {
      await close?.();
      if (root) await rm(root, { recursive: true, force: true });
    });
    async function seed() {
      const id = `recovery-${randomUUID()}`;
      await state.create<User>("users", id, {
        id,
        email: `${id}@example.test`,
        name: "Recovery admin",
        role: "admin",
        disabled: true,
        authVersion: 4,
        passwordHash: "existing-test-hash",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await state.create("sessions", id, { userId: id, authVersion: 4 });
      await state.create("tokens", id, { ownerId: id, authVersion: 4 });
      return {
        userId: id,
        expectedVersion: 1,
        confirm: id,
        backupAcknowledged: true,
        reason: "Storage recovery exercise",
        password: "new-storage-recovery-password",
      };
    }
    it("commits account, credential revocation and audit together", async () => {
      const input = await seed();
      const result = await new Operations(state).recover(input);
      expect(result.userId).toBe(input.userId);
      expect((await state.get<User>("users", input.userId))?.value).toMatchObject({
        disabled: false,
        authVersion: 5,
      });
      expect(await state.get("sessions", input.userId)).toBeUndefined();
      expect(await state.get("tokens", input.userId)).toBeUndefined();
      const audit = await new Operations(state).audit({ action: "user.recovered" });
      expect(audit.events.some((event) => event.details.userId === input.userId)).toBe(true);
    });
    it("rejects an account change made after preview", async () => {
      const input = await seed();
      const account = (await state.get<User>("users", input.userId))!;
      account.value.role = "member";
      expect(await state.replace("users", account)).toBe(true);
      await expect(new Operations(state).recover(input)).rejects.toThrow();
      expect((await state.get<User>("users", input.userId))?.value.role).toBe("member");
      expect(await state.get("sessions", input.userId)).toBeTruthy();
    });
    it("does not apply two recoveries using the same preview", async () => {
      const input = await seed();
      const result = await Promise.allSettled([
        new Operations(state).recover(input),
        new Operations(state).recover(input),
      ]);
      expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect((await state.get<User>("users", input.userId))?.value.authVersion).toBe(5);
    });
  });
}

it("restores a closed native SQLite snapshot with canonical identity and review attribution", async () => {
  const root = await mkdtemp(join(tmpdir(), "vg-native-restore-"));
  let db: Awaited<ReturnType<typeof openDatabase>> | undefined;
  try {
    const source = join(root, "source.sqlite"),
      snapshot = join(root, "snapshot.sqlite"),
      restored = join(root, "restored.sqlite");
    db = await openDatabase({ sqlitePath: source });
    let state = new SqlStateStore(db);
    const records: [string, string, unknown][] = [
      [
        "users",
        "canonical-user",
        {
          id: "canonical-user",
          email: "kept@example.test",
          role: "admin",
          passwordHash: "native-secret-state",
          authVersion: 8,
        },
      ],
      [
        "external-identities",
        "google-mapping",
        {
          userId: "canonical-user",
          issuer: "https://accounts.google.com",
          subject: "retained-subject",
        },
      ],
      [
        "memberships",
        "canonical-user:demo",
        { userId: "canonical-user", projectId: "demo", role: "reviewer" },
      ],
      ["reviews", "demo:run:job", { events: [{ actorId: "canonical-user", kind: "approve" }] }],
      ["invitations", "accepted", { status: "accepted", userId: "canonical-user" }],
      ["admission", "current", { mode: "invite", bootstrapComplete: true }],
    ];
    for (const [namespace, id, value] of records) await state.create(namespace, id, value);
    await db.close();
    db = undefined;
    await copyFile(source, snapshot);
    await copyFile(snapshot, restored);
    db = await openDatabase({ sqlitePath: restored });
    state = new SqlStateStore(db);
    for (const [namespace, id, value] of records)
      expect((await state.get(namespace, id))?.value).toEqual(value);
    const review = await state.get<{ events: { actorId: string }[] }>("reviews", "demo:run:job");
    expect(review?.value.events[0]?.actorId).toBe("canonical-user");
  } finally {
    await db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
