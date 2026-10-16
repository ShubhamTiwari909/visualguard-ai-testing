import { randomUUID } from "node:crypto";
import { PlatformError } from "./errors.js";
import type { Actor, Membership, User } from "./auth.js";
import type { StateRecord, StateStore } from "./storage-contracts.js";

export interface AdministratorProof {
  userId: string;
  sessionId: string;
  authVersion: number;
  provedAt: string;
}
interface BrowserSession {
  userId: string;
  authVersion: number;
  authentication?: "password" | "oidc";
  authenticatedAt?: string;
}
export const publicAccount = (row: StateRecord<User>) => ({
  id: row.id,
  name: row.value.name,
  email: row.value.email,
  role: row.value.role,
  disabled: row.value.disabled,
  createdAt: row.value.createdAt,
  version: row.version,
});
const changed = () =>
  new PlatformError(409, "Account changed; refresh its details before trying again");

/** All supported paths that change administrator eligibility share this write fence. */
export async function touchAdministratorGuard(store: StateStore) {
  let row = await store.get<{ schemaVersion: number }>("administrator-guard", "workspace");
  if (!row) {
    if (!(await store.create("administrator-guard", "workspace", { schemaVersion: 1 })))
      throw changed();
    row = (await store.get<{ schemaVersion: number }>("administrator-guard", "workspace"))!;
  }
  if (row.value.schemaVersion !== 1)
    throw new PlatformError(503, "Administrator storage requires a compatible dashboard version");
  if (!(await store.replace("administrator-guard", row))) throw changed();
}

export class Administration {
  constructor(private state: StateStore) {}
  async available() {
    return Boolean(this.state.transaction) && ((await this.state.supportsTransactions?.()) ?? true);
  }
  private async transaction<T>(work: (store: StateStore) => Promise<T>) {
    if (!(await this.available()))
      throw new PlatformError(
        503,
        "Account administration requires SQLite, PostgreSQL, or a MongoDB replica set",
      );
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.state.transaction!(async (store) => {
          await touchAdministratorGuard(store);
          return work(store);
        });
      } catch (error) {
        if (!(error instanceof PlatformError && error.status === 409 && attempt < 2)) throw error;
      }
    }
  }
  private browser(actor: Actor) {
    if (!actor.admin || actor.credentialId || !actor.sessionId)
      throw new PlatformError(403, "A signed-in workspace administrator is required");
  }
  private async authority(store: StateStore, actor: Actor, proof?: AdministratorProof) {
    this.browser(actor);
    const user = await store.get<User>("users", actor.id);
    const session = await store.get<BrowserSession>("sessions", actor.sessionId!);
    if (
      !user ||
      user.value.disabled ||
      user.value.role !== "admin" ||
      !session ||
      session.value.userId !== actor.id ||
      session.value.authVersion !== user.value.authVersion
    )
      throw new PlatformError(403, "Administrator access changed; sign in again");
    if (proof) {
      const age = Date.now() - Date.parse(proof.provedAt);
      if (
        proof.userId !== actor.id ||
        proof.sessionId !== actor.sessionId ||
        proof.authVersion !== user.value.authVersion ||
        !Number.isFinite(age) ||
        age < 0 ||
        age > 300_000
      )
        throw new PlatformError(401, "Verify your administrator account again");
      if (!user.value.passwordHash) {
        const loginAge = Date.now() - Date.parse(session.value.authenticatedAt ?? "");
        if (
          session.value.authentication !== "oidc" ||
          !Number.isFinite(loginAge) ||
          loginAge < 0 ||
          loginAge > 300_000
        )
          throw new PlatformError(401, "Sign in again before administering accounts");
      }
    }
    // Re-read inside mutations as well as at the HTTP boundary; snapshot reads alone are insufficient.
    if (!(await store.replace("users", user)) || !(await store.replace("sessions", session)))
      throw changed();
  }
  private async audit(
    store: StateStore,
    actorId: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    if (
      !(await store.create(
        "audit",
        `${String(9_999_999_999_999 - Date.now()).padStart(13, "0")}:${randomUUID()}`,
        {
          actorId,
          action,
          details,
          at: new Date().toISOString(),
        },
        new Date(Date.now() + 90 * 86400_000).toISOString(),
      ))
    )
      throw changed();
  }
  private async methods(row: StateRecord<User>) {
    const identities = await this.state.list<{ provider: string }>(
      "user-identities",
      `${row.id}:`,
      100,
    );
    const methods = new Set<string>();
    if (row.value.passwordHash) methods.add("password");
    for (const identity of identities)
      if (["google", "oidc"].includes(identity.value.provider))
        methods.add(identity.value.provider);
    if (row.id.startsWith("oidc-") && !identities.length) methods.add("legacy-oidc");
    return [...methods];
  }
  async directory(
    actor: Actor,
    input: { query?: string; role?: string; status?: string; after?: string } = {},
  ) {
    this.browser(actor);
    const users: Array<ReturnType<typeof publicAccount> & { methods: string[] }> = [];
    const query = input.query?.trim().toLowerCase() ?? "";
    let after = input.after,
      exhausted = false;
    // Bound sparse-filter work too. A page may be empty with a continuation cursor.
    for (let scanned = 0; scanned < 200 && users.length < 50 && !exhausted;) {
      const page = await this.state.list<User>("users", "", Math.min(50, 200 - scanned), after);
      if (!page.length) break;
      for (const row of page) {
        scanned++;
        after = row.id;
        if (
          (!query ||
            `${row.value.name} ${row.value.email} ${row.id}`.toLowerCase().includes(query)) &&
          (!input.role || row.value.role === input.role) &&
          (!input.status || row.value.disabled === (input.status === "disabled"))
        )
          users.push({ ...publicAccount(row), methods: await this.methods(row) });
        if (users.length === 50 || scanned === 200) break;
      }
      exhausted = page.length < 50 && after === page.at(-1)!.id;
    }
    const more = after && !exhausted && (await this.state.list("users", "", 1, after)).length;
    return {
      users,
      after: more ? after : undefined,
      administrationAvailable: await this.available(),
    };
  }
  async detail(actor: Actor, id: string, after?: string) {
    this.browser(actor);
    const row = await this.state.get<User>("users", id);
    if (!row) throw new PlatformError(404, "Account not found");
    const prefix = `${id}:`;
    if (after && !after.startsWith(prefix))
      throw new PlatformError(400, "Invalid membership cursor");
    const memberships = await this.state.list<Membership>("memberships", prefix, 51, after);
    return {
      user: { ...publicAccount(row), methods: await this.methods(row) },
      memberships: memberships.slice(0, 50).map((item) => item.value),
      after: memberships.length > 50 ? memberships[49]!.id : undefined,
      administrationAvailable: await this.available(),
    };
  }
  async createMember(actor: Actor, user: User) {
    if (user.role !== "member")
      throw new PlatformError(400, "Create a member first, then explicitly promote that account");
    return this.transaction(async (store) => {
      await this.authority(store, actor);
      if (!(await store.create("users", user.id, user)))
        throw new PlatformError(409, "An account with this email already exists");
      await this.audit(store, actor.id, "user.created", { userId: user.id, role: "member" });
      return publicAccount({ id: user.id, value: user, version: 1 });
    });
  }
  private async activeAdministrators(store: StateStore) {
    let after: string | undefined,
      count = 0;
    for (;;) {
      const rows = await store.list<User>("users", "", 100, after);
      count += rows.filter((row) => !row.value.disabled && row.value.role === "admin").length;
      if (rows.length < 100) return count;
      after = rows.at(-1)!.id;
    }
  }
  private async revokeCredentials(store: StateStore, id: string) {
    // The authVersion check invalidates in-flight/new tokens; delete legacy owner-bound credentials too.
    for (const namespace of ["sessions", "tokens"]) {
      let after: string | undefined;
      for (;;) {
        const rows = await store.list<{ userId?: string; ownerId?: string }>(
          namespace,
          "",
          100,
          after,
        );
        for (const row of rows)
          if (
            (namespace === "sessions" ? row.value.userId : row.value.ownerId) === id &&
            !(await store.remove(namespace, row.id, row.version))
          )
            throw changed();
        if (rows.length < 100) break;
        after = rows.at(-1)!.id;
      }
    }
  }
  async change(
    actor: Actor,
    id: string,
    input: {
      expectedVersion: number;
      disabled?: boolean;
      role?: "admin" | "member";
      passwordHash?: string;
      revoke?: boolean;
    },
    proof: AdministratorProof,
  ) {
    return this.transaction(async (store) => {
      // Compare the caller's target version before authority's intentional guard write to self.
      const original = await store.get<User>("users", id);
      if (!original) throw new PlatformError(404, "Account not found");
      if (original.version !== input.expectedVersion) throw changed();
      await this.authority(store, actor, proof);
      if (id === actor.id && (input.disabled === true || input.role === "member"))
        throw new PlatformError(400, "You cannot disable or demote your own administrator account");
      const target = (await store.get<User>("users", id))!;
      if (target.version !== original.version + (id === actor.id ? 1 : 0)) throw changed();
      const before = { role: target.value.role, disabled: target.value.disabled };
      const disabled = input.disabled ?? target.value.disabled,
        role = input.role ?? target.value.role;
      if (input.passwordHash && !target.value.passwordHash)
        throw new PlatformError(400, "Password reset requires an existing password account");
      if (
        !input.revoke &&
        !input.passwordHash &&
        disabled === before.disabled &&
        role === before.role
      )
        throw new PlatformError(400, "Choose an account change");
      if (
        !before.disabled &&
        before.role === "admin" &&
        (disabled || role !== "admin") &&
        (await this.activeAdministrators(store)) <= 1
      )
        throw new PlatformError(409, "Keep at least one active workspace administrator");
      target.value = {
        ...target.value,
        disabled,
        role,
        authVersion: target.value.authVersion + 1,
        ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      };
      if (!(await store.replace("users", target))) throw changed();
      await this.revokeCredentials(store, id);
      await this.audit(store, actor.id, input.revoke ? "user.sessions-revoked" : "user.updated", {
        userId: id,
        before,
        after: { role, disabled },
        passwordReset: Boolean(input.passwordHash),
        uploadCredentialsRevoked: true,
      });
      return {
        ...publicAccount({ ...target, version: target.version + 1 }),
        credentialsRevoked: true,
      };
    });
  }
}
