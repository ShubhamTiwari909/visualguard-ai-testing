import { randomBytes, randomUUID, scrypt as deriveKey } from "node:crypto";
import { promisify } from "node:util";
import type { User } from "./auth.js";
import { touchAdministratorGuard } from "./administration.js";
import { PlatformError } from "./errors.js";
import type { StateStore } from "./storage-contracts.js";
import type { AuditEvent, AuditPage, OperationsStatus } from "../shared/operations.js";

const scrypt = promisify(deriveKey);
const detailKeys = new Set([
  "userId",
  "projectId",
  "runId",
  "role",
  "provider",
  "before",
  "after",
  "passwordReset",
  "uploadCredentialsRevoked",
  "reason",
  "backupAcknowledged",
  "name",
  "publicId",
  "created",
  "invitationId",
]);
function safeDetails(input: unknown): AuditEvent["details"] {
  const result: AuditEvent["details"] = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const [key, value] of Object.entries(input)) {
    if (!detailKeys.has(key)) continue;
    if (key === "role" && value === null) {
      result[key] = "Removed";
      continue;
    }
    if (typeof value === "string") result[key] = value.slice(0, 500);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
      result[key] = value;
    else if ((key === "before" || key === "after") && value && typeof value === "object") {
      const state = value as { role?: unknown; disabled?: unknown };
      result[key] = {
        ...(typeof state.role === "string" ? { role: state.role.slice(0, 40) } : {}),
        ...(typeof state.disabled === "boolean" ? { disabled: state.disabled } : {}),
      };
    }
  }
  return result;
}
interface StoredAudit {
  actorId: string;
  action: string;
  at: string;
  details: unknown;
}

export class Operations {
  constructor(private state: StateStore) {}

  async audit(
    input: {
      after?: string;
      action?: string;
      person?: string;
      since?: string;
      until?: string;
    } = {},
  ): Promise<AuditPage> {
    const rows = await this.state.list<StoredAudit>("audit", "", 201, input.after);
    const events: AuditEvent[] = [];
    let cursor = input.after;
    let scanned = 0;
    const people = new Map<string, User | undefined>();
    for (const row of rows.slice(0, 200)) {
      cursor = row.id;
      scanned++;
      const event = row.value;
      if (
        !event ||
        typeof event.action !== "string" ||
        typeof event.actorId !== "string" ||
        typeof event.at !== "string" ||
        !Number.isFinite(Date.parse(event.at))
      )
        continue;
      if (input.action && event.action !== input.action) continue;
      if (input.since && Date.parse(event.at) < Date.parse(input.since)) continue;
      if (input.until && Date.parse(event.at) > Date.parse(input.until)) continue;
      if (!people.has(event.actorId))
        people.set(event.actorId, (await this.state.get<User>("users", event.actorId))?.value);
      const person = people.get(event.actorId);
      const actorName =
        person?.name ||
        (event.actorId === "host-operator"
          ? "Host operator"
          : event.actorId === "local-owner"
            ? "Local workspace"
            : "Former account");
      if (
        input.person &&
        !`${actorName} ${person?.email ?? ""} ${event.actorId}`
          .toLowerCase()
          .includes(input.person.toLowerCase())
      )
        continue;
      events.push({
        id: row.id,
        actorId: event.actorId,
        actorName,
        actorEmail: person?.email ?? "",
        action: event.action.slice(0, 120),
        at: event.at,
        details: safeDetails(event.details),
      });
      if (events.length === 50) break;
    }
    return {
      events,
      ...(cursor && scanned < rows.length ? { nextCursor: cursor } : {}),
    };
  }

  async status(): Promise<OperationsStatus> {
    const [rows, schema, admission, transactions] = await Promise.all([
      this.state.list<User>("users", "", 201),
      this.state.get<{ version: number }>("identity-schema", "current"),
      this.state.get<{ mode: string }>("admission", "current"),
      this.state.supportsTransactions?.() ?? Promise.resolve(Boolean(this.state.transaction)),
    ]);
    const users = rows.slice(0, 200).map((row) => row.value);
    const active = users.filter((user) => user.role === "admin" && !user.disabled);
    const emails = new Map<string, number>();
    for (const user of users) {
      if (user.email) {
        const email = user.email.trim().toLowerCase();
        emails.set(email, (emails.get(email) ?? 0) + 1);
      }
    }
    const result: OperationsStatus = {
      transactions: Boolean(this.state.transaction) && transactions,
      identitySchema: schema?.value.version ?? null,
      admission: admission?.value.mode ?? "not initialized",
      accountsScanned: users.length,
      inventoryComplete: rows.length <= 200,
      activeAdministrators: active.length,
      activePasswordAdministrators: active.filter((user) => user.passwordHash).length,
      duplicateEmails: [...emails.values()].filter((count) => count > 1).length,
      duplicateEmailGroups: [...emails.entries()]
        .filter(([, count]) => count > 1)
        .map(([email, accounts]) => ({ email, accounts })),
      warnings: [],
    };
    if (!result.transactions)
      result.warnings.push(
        "Transactional onboarding and administrator recovery are unavailable on this storage deployment.",
      );
    if (schema && schema.value.version !== 1)
      result.warnings.push(
        "The identity schema needs a compatible dashboard version. Do not downgrade or rewrite identity records.",
      );
    if (!result.inventoryComplete)
      result.warnings.push(
        "Only the first 200 accounts were scanned. Counts and duplicate-email checks are incomplete.",
      );
    if (result.inventoryComplete && !result.activePasswordAdministrators)
      result.warnings.push(
        "There is no active password administrator. Keep a tested password administrator for provider outages.",
      );
    if (result.duplicateEmails)
      result.warnings.push(
        "Some accounts share an email address. Review their ownership; never merge them automatically.",
      );
    return result;
  }

  async recoveryAdministrators(after?: string) {
    const rows = await this.state.list<User>("users", "", 201, after);
    return {
      accounts: rows
        .slice(0, 200)
        .filter((row) => row.value.role === "admin" && row.value.passwordHash)
        .map((row) => ({
          id: row.id,
          email: row.value.email,
          name: row.value.name,
          disabled: row.value.disabled,
          version: row.version,
        })),
      ...(rows.length > 200 ? { nextCursor: rows[199]!.id } : {}),
    };
  }

  async previewRecovery(id: string) {
    const row = await this.state.get<User>("users", id);
    if (!row || row.value.id !== row.id || row.value.role !== "admin" || !row.value.passwordHash)
      throw new PlatformError(
        400,
        "Choose an existing password administrator; recovery cannot create or promote accounts",
      );
    return {
      userId: row.id,
      email: row.value.email,
      name: row.value.name,
      disabled: row.value.disabled,
      expectedVersion: row.version,
    };
  }

  async recover(input: {
    userId: string;
    expectedVersion: number;
    confirm: string;
    backupAcknowledged: boolean;
    reason: string;
    password: string;
  }) {
    if (
      !input.backupAcknowledged ||
      input.confirm !== input.userId ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !input.reason.trim() ||
      input.reason.length > 500
    )
      throw new PlatformError(
        400,
        "A native backup, exact account confirmation, preview version, and recovery reason are required",
      );
    if (input.password.length < 12 || input.password.length > 256)
      throw new PlatformError(400, "Use a replacement password of 12–256 characters");
    if (input.reason.includes(input.password))
      throw new PlatformError(400, "Do not include the replacement password in the recovery reason");
    if (!this.state.transaction || !(await this.state.supportsTransactions?.() ?? true))
      throw new PlatformError(503, "Recovery requires SQLite, PostgreSQL, or a MongoDB replica set");
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(input.password, salt, 64)) as Buffer;
    return this.state.transaction(async (store) => {
      await touchAdministratorGuard(store);
      const schema = await store.get<{ version: number }>("identity-schema", "current");
      if (schema && schema.value.version !== 1)
        throw new PlatformError(503, "Recovery requires a compatible identity schema");
      const row = await store.get<User>("users", input.userId);
      if (!row || row.value.id !== row.id || row.value.role !== "admin" || !row.value.passwordHash)
        throw new PlatformError(400, "Recovery requires an existing password administrator");
      if (row.version !== input.expectedVersion)
        throw new PlatformError(409, "Account changed; preview recovery again");
      if (!Number.isSafeInteger(row.value.authVersion) || row.value.authVersion < 1)
        throw new PlatformError(503, "Recovery requires a valid account credential version");
      row.value = {
        ...row.value,
        disabled: false,
        authVersion: row.value.authVersion + 1,
        passwordHash: `scrypt$${salt}$${key.toString("hex")}`,
      };
      if (!(await store.replace("users", row)))
        throw new PlatformError(409, "Account changed; preview recovery again");
      for (const namespace of ["sessions", "tokens"]) {
        let after: string | undefined;
        for (;;) {
          const rows = await store.list<{ userId?: string; ownerId?: string }>(
            namespace,
            "",
            100,
            after,
          );
          for (const credential of rows) {
            const owner =
              namespace === "sessions" ? credential.value.userId : credential.value.ownerId;
            if (owner === row.id && !(await store.remove(namespace, credential.id, credential.version)))
              throw new PlatformError(409, "Credentials changed; preview recovery again");
          }
          if (rows.length < 100) break;
          after = rows.at(-1)!.id;
        }
      }
      const now = Date.now();
      if (
        !(await store.create(
          "audit",
          `${String(9_999_999_999_999 - now).padStart(13, "0")}:${randomUUID()}`,
          {
            actorId: "host-operator",
            action: "user.recovered",
            at: new Date(now).toISOString(),
            details: {
              userId: row.id,
              reason: input.reason.trim(),
              backupAcknowledged: true,
              passwordReset: true,
              uploadCredentialsRevoked: true,
            },
          },
          new Date(now + 90 * 86400_000).toISOString(),
        ))
      )
        throw new PlatformError(503, "Unable to record recovery; no account changes were saved");
      return { userId: row.id, credentialsRevoked: true, version: row.version + 1 };
    });
  }
}
