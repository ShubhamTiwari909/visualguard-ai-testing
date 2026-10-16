import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operationsCommand, readRecoveryPassword } from "../server/operations-command.js";
import { openPlatform } from "../server/config.js";
import type { User } from "../server/auth.js";

describe("host operations command", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "vg-operations-command-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("provides help and rejects incomplete recovery before opening storage", async () => {
    expect(await operationsCommand(["--help"], {})).toHaveProperty("recovery");
    await expect(operationsCommand(["recover", "--user", "admin"], {})).rejects.toThrow("backup acknowledgement");
    await expect(operationsCommand(["unknown"], {})).rejects.toThrow("Choose status");
  });

  it.skipIf(process.platform === "win32")("requires an owned private regular password file", async () => {
    const path = join(root, "password");
    await writeFile(path, "private-test-password\n", { mode: 0o600 });
    expect(await readRecoveryPassword(path)).toBe("private-test-password");
    await chmod(path, 0o644);
    await expect(readRecoveryPassword(path)).rejects.toThrow("private");
    await chmod(path, 0o600);
    const link = join(root, "symlink");
    await symlink(path, link);
    await expect(readRecoveryPassword(link)).rejects.toThrow();
    await expect(readRecoveryPassword(root)).rejects.toThrow("regular");
    await writeFile(path, "short");
    await expect(readRecoveryPassword(path)).rejects.toThrow("12–256");
    await writeFile(path, Buffer.alloc(1025, 97));
    await expect(readRecoveryPassword(path)).rejects.toThrow("1024");
    await writeFile(path, Buffer.from([0xff]));
    await expect(readRecoveryPassword(path)).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32")("runs preview and confirmed recovery against the selected local database", async () => {
    const env = { VISUALGUARD_PLATFORM_DATA_DIR: root };
    const platform = await openPlatform(env);
    await platform.state.create<User>("users", "admin", {
      id: "admin", name: "Admin", email: "admin@example.test", role: "admin", disabled: true,
      authVersion: 1, passwordHash: "old-hash", createdAt: "2026-01-01T00:00:00.000Z",
    });
    await platform.close();
    expect(await operationsCommand(["admins"], env)).toMatchObject({ accounts: [{ id: "admin" }] });
    const preview = await operationsCommand(["preview", "--user", "admin"], env);
    expect(preview).toMatchObject({ userId: "admin", expectedVersion: 1 });
    const path = join(root, "password");
    await writeFile(path, "replacement-command-password", { mode: 0o600 });
    const result = await operationsCommand([
      "recover", "--user", "admin", "--version", "1", "--confirm", "admin", "--backup-confirmed",
      "--reason", "Local command exercise", "--password-file", path,
    ], env);
    expect(result).toMatchObject({ userId: "admin", credentialsRevoked: true });
    expect(JSON.stringify(result)).not.toContain("replacement-command-password");
  });
});
