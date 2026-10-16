import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryStateStore, type User } from "../server/auth.js";
import { Operations } from "../server/operations.js";
import type { StateStore } from "../server/storage-contracts.js";

const user = (id: string, extra: Partial<User> = {}): User => ({
  id, name: id, email: `${id}@example.test`, role: "admin", disabled: false,
  authVersion: 1, passwordHash: "old-test-hash", createdAt: "2026-01-01T00:00:00.000Z", ...extra,
});
const recover = (id: string, extra = {}) => ({
  userId: id, expectedVersion: 1, confirm: id, backupAcknowledged: true,
  reason: "Provider outage recovery exercise", password: "new-test-only-password", ...extra,
});
const bind = (state: StateStore): StateStore => ({
  get: state.get.bind(state),
  create: state.create.bind(state),
  replace: state.replace.bind(state),
  remove: state.remove.bind(state),
  list: state.list.bind(state),
  pruneExpired: state.pruneExpired.bind(state),
  supportsTransactions: state.supportsTransactions?.bind(state),
  transaction: state.transaction?.bind(state),
});

describe("workspace operations", () => {
  let state: MemoryStateStore, operations: Operations;
  beforeEach(() => {
    state = new MemoryStateStore();
    operations = new Operations(state);
  });
  const event = (index: number, action = "user.updated", details: unknown = {}, actorId = "admin") => ({
    id: `${String(index).padStart(13, "0")}:${randomUUID()}`,
    value: { actorId, action, at: "2026-10-16T12:01:00.000Z", details },
  });

  it("paginates sparse audit filters without declaring the scan complete", async () => {
    for (let index = 0; index < 201; index++) {
      const row = event(index, index === 200 ? "user.recovered" : "user.login");
      await state.create("audit", row.id, row.value);
    }
    const first = await operations.audit({ action: "user.recovered" });
    expect(first.events).toEqual([]);
    expect(first.nextCursor).toBeTruthy();
    const next = await operations.audit({ action: "user.recovered", after: first.nextCursor });
    expect(next.events).toHaveLength(1);
    expect(next.nextCursor).toBeUndefined();
  });

  it("returns every event exactly once across full pages", async () => {
    for (let index = 0; index < 101; index++) {
      const row = event(index);
      await state.create("audit", row.id, row.value);
    }
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const page = await operations.audit({ after });
      expect(page.events.length).toBeLessThanOrEqual(50);
      ids.push(...page.events.map((value) => value.id));
      after = page.nextCursor;
    } while (after);
    expect(ids).toHaveLength(101);
    expect(new Set(ids).size).toBe(101);
  });

  it("joins actor names and filters dates with timezone offsets", async () => {
    await state.create("users", "admin", user("admin", { name: "Account Owner" }));
    const row = event(1);
    await state.create("audit", row.id, row.value);
    const page = await operations.audit({ person: "OWNER", since: "2026-10-16T14:00:00+02:00" });
    expect(page.events[0]?.actorName).toBe("Account Owner");
    expect(page.events[0]?.actorEmail).toBe("admin@example.test");
    expect((await operations.audit({ until: "2026-10-16T12:00:00Z" })).events).toEqual([]);
  });

  it("omits unapproved audit fields and nested credential material", async () => {
    const row = event(1, "user.updated", {
      userId: "target", password: "SECRET", passwordHash: "SECRET", subject: "SECRET",
      clientSecret: "SECRET", token: "SECRET", before: { role: "member", passwordHash: "SECRET" },
      after: { role: "admin", disabled: false, authVersion: "SECRET" },
    });
    await state.create("audit", row.id, row.value);
    const page = await operations.audit();
    expect(JSON.stringify(page)).not.toContain("SECRET");
    expect(page.events[0]?.details).toEqual({
      userId: "target", before: { role: "member" }, after: { role: "admin", disabled: false },
    });
  });

  it("preserves access-removal meaning and searches special operator names", async () => {
    const row = event(1, "membership.changed", { role: null }, "host-operator");
    await state.create("audit", row.id, row.value);
    const page = await operations.audit({ person: "Host operator" });
    expect(page.events[0]?.details.role).toBe("Removed");
    const local = event(2, "project.created", {}, "local-owner");
    await state.create("audit", local.id, local.value);
    expect((await operations.audit({ person: "Local workspace" })).events[0]?.actorName).toBe("Local workspace");
  });

  it("reports incomplete inventories and email collisions without merging accounts", async () => {
    for (let index = 0; index < 201; index++)
      await state.create("users", `user-${index}`, user(`user-${index}`, { role: "member", email: "duplicate@example.test" }));
    const status = await operations.status();
    expect(status.inventoryComplete).toBe(false);
    expect(status.accountsScanned).toBe(200);
    expect(status.duplicateEmails).toBe(1);
    expect(status.duplicateEmailGroups).toEqual([{ email: "duplicate@example.test", accounts: 200 }]);
    expect(status.warnings.join(" ")).toContain("incomplete");
    expect(status.warnings.join(" ")).not.toContain("There is no active password administrator");
    expect(await state.list("users", "", 1000)).toHaveLength(201);
  });

  it("warns about storage, schema and missing password administrators", async () => {
    await state.create("identity-schema", "current", { version: 2 });
    const unsupported = bind(state);
    unsupported.supportsTransactions = async () => false;
    const status = await new Operations(unsupported).status();
    expect(status.transactions).toBe(false);
    expect(status.identitySchema).toBe(2);
    expect(status.warnings).toHaveLength(3);
  });

  it("previews only existing password administrators without credential hashes", async () => {
    await state.create("users", "admin", user("admin", { disabled: true }));
    await state.create("users", "member", user("member", { role: "member" }));
    await state.create("users", "google", user("google", { passwordHash: undefined }));
    expect(await operations.previewRecovery("admin")).toMatchObject({ userId: "admin", expectedVersion: 1, disabled: true });
    expect(JSON.stringify(await operations.recoveryAdministrators())).not.toContain("old-test-hash");
    for (const id of ["member", "google", "missing"])
      await expect(operations.previewRecovery(id)).rejects.toThrow("existing password administrator");
  });

  it("recovers atomically while preserving identities, memberships and historical actors", async () => {
    await state.create("users", "admin", user("admin", { disabled: true }));
    await state.create("external-identities", "google-owner", { userId: "admin", subject: "unchanged" });
    await state.create("memberships", "admin:demo", { userId: "admin", projectId: "demo", role: "reviewer" });
    await state.create("reviews", "historic", { actorId: "admin", decision: "approved" });
    for (let index = 0; index < 105; index++) {
      await state.create("sessions", `session-${index}`, { userId: "admin", authVersion: 1 });
      await state.create("tokens", `token-${index}`, { ownerId: "admin", authVersion: 1 });
    }
    await state.create("sessions", "other", { userId: "someone-else" });
    const result = await operations.recover(recover("admin"));
    expect(result.credentialsRevoked).toBe(true);
    const account = (await state.get<User>("users", "admin"))!.value;
    expect(account).toMatchObject({ disabled: false, role: "admin", authVersion: 2, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(account.passwordHash).toMatch(/^scrypt\$/);
    expect(await state.list("sessions")).toHaveLength(1);
    expect(await state.list("tokens")).toEqual([]);
    expect((await state.get<{ actorId: string }>("reviews", "historic"))?.value.actorId).toBe("admin");
    expect((await state.get("external-identities", "google-owner"))?.value).toEqual({ userId: "admin", subject: "unchanged" });
    expect(await state.get("memberships", "admin:demo")).toBeTruthy();
    const audit = await operations.audit();
    expect(audit.events[0]?.action).toBe("user.recovered");
    expect(audit.events[0]?.actorName).toBe("Host operator");
    expect(JSON.stringify(audit)).not.toContain("new-test-only-password");
  });

  it("rejects stale previews, missing backup acknowledgement and wrong confirmations", async () => {
    await state.create("users", "admin", user("admin"));
    for (const extra of [{ expectedVersion: 2 }, { backupAcknowledged: false }, { confirm: "other" }, { reason: "" }, { reason: "Password: new-test-only-password" }])
      await expect(operations.recover(recover("admin", extra))).rejects.toThrow();
    expect((await state.get<User>("users", "admin"))?.value.authVersion).toBe(1);
    expect(await state.list("audit")).toEqual([]);
  });

  it("rejects unsupported schemas without account or guard changes", async () => {
    await state.create("users", "admin", user("admin"));
    await state.create("identity-schema", "current", { version: 99 });
    await expect(operations.recover(recover("admin"))).rejects.toThrow("compatible identity schema");
    expect((await state.get<User>("users", "admin"))?.value.authVersion).toBe(1);
    expect(await state.get("administrator-guard", "workspace")).toBeUndefined();
  });

  it("refuses a corrupt credential version instead of resetting its revocation fence", async () => {
    await state.create("users", "admin", user("admin", { authVersion: Number.NaN }));
    await expect(operations.recover(recover("admin"))).rejects.toThrow("credential version");
    expect(await state.list("audit")).toEqual([]);
  });

  it("rolls back password changes and credential deletion when audit cannot commit", async () => {
    await state.create("users", "admin", user("admin"));
    await state.create("sessions", "existing", { userId: "admin" });
    await state.create("tokens", "existing", { ownerId: "admin" });
    const fault = bind(state);
    fault.transaction = (work) => state.transaction((transaction) => {
      const store = bind(transaction);
      const create = transaction.create.bind(transaction);
      store.create = (namespace, ...args) => namespace === "audit" ? Promise.resolve(false) : create(namespace, ...args);
      return work(store);
    });
    await expect(new Operations(fault).recover(recover("admin"))).rejects.toThrow("Unable to record recovery");
    expect((await state.get<User>("users", "admin"))?.value.passwordHash).toBe("old-test-hash");
    expect(await state.get("sessions", "existing")).toBeTruthy();
    expect(await state.get("tokens", "existing")).toBeTruthy();
  });
});
