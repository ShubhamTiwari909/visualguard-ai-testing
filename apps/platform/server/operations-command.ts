import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openPlatform } from "./config.js";
import { Operations } from "./operations.js";

export async function readRecoveryPassword(path: string) {
  if (process.platform === "win32")
    throw new Error(
      "Run password recovery on a POSIX dashboard host where private-file permissions can be verified",
    );
  if (typeof constants.O_NOFOLLOW !== "number")
    throw new Error("This host cannot verify password-file symlinks safely");
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0);
  const file = await open(path, flags);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1024)
      throw new Error("Use a regular password file no larger than 1024 bytes");
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
      throw new Error("The password file must be owned by your user and private (chmod 600)");
    const bytes = Buffer.alloc(1025);
    let length = 0;
    while (length < bytes.length) {
      const part = await file.read(bytes, length, bytes.length - length, null);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > 1024) throw new Error("Password file is too large");
    const password = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(0, length))
      .replace(/\r?\n$/, "");
    if (password.length < 12 || password.length > 256 || /[\r\n]/.test(password))
      throw new Error("The password file must contain one 12–256 character password");
    return password;
  } finally {
    await file.close();
  }
}

export async function operationsCommand(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      user: { type: "string" },
      after: { type: "string" },
      version: { type: "string" },
      confirm: { type: "string" },
      reason: { type: "string" },
      "password-file": { type: "string" },
      "backup-confirmed": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help)
    return {
      usage:
        "pnpm platform:operations <status|admins|preview|recover> [--user ID] [--after CURSOR]",
      recovery:
        "recover --user ID --version PREVIEW_VERSION --confirm ID --backup-confirmed --reason REASON --password-file PRIVATE_FILE",
      warning:
        "Stop dashboard instances and take a native operational database backup before recovery. No HTTP recovery endpoint exists.",
      platform:
        "Password recovery requires a POSIX operator host to verify private-file ownership and permissions.",
    };
  const command = positionals[0] ?? "status";
  if (positionals.length > 1 || !["status", "admins", "preview", "recover"].includes(command))
    throw new Error("Choose status, admins, preview, or recover; use --help for instructions");
  if ((command === "preview" || command === "recover") && !values.user)
    throw new Error("Choose the exact account ID with --user");
  if (
    command === "recover" &&
    (!values["backup-confirmed"] ||
      !values.version ||
      !/^\d+$/.test(values.version) ||
      values.confirm !== values.user ||
      !values.reason?.trim() ||
      !values["password-file"])
  )
    throw new Error(
      "Recovery requires a backup acknowledgement, preview version, account confirmation, reason, and private password file",
    );
  const platform = await openPlatform(env);
  try {
    const operations = new Operations(platform.state);
    if (command === "status") return await operations.status();
    if (command === "admins") return await operations.recoveryAdministrators(values.after);
    if (command === "preview") return await operations.previewRecovery(values.user!);
    return await operations.recover({
      userId: values.user!,
      expectedVersion: Number(values.version),
      confirm: values.confirm!,
      backupAcknowledged: values["backup-confirmed"]!,
      reason: values.reason!,
      password: await readRecoveryPassword(values["password-file"]!),
    });
  } finally {
    await platform.close();
  }
}
