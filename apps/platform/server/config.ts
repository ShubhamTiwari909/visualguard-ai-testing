import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { FileArtifactStore } from "./artifacts.js";
import { Repository } from "./repository.js";

export async function openPlatform(env: NodeJS.ProcessEnv = process.env) {
  const dataDir = resolve(env.VISUALGUARD_PLATFORM_DATA_DIR ?? fileURLToPath(new URL("../../../.visualguard/platform", import.meta.url)));
  const db = await openDatabase({ url: env.DATABASE_URL, sqlitePath: resolve(dataDir, "metadata.sqlite") });
  return { repository: new Repository(db), store: new FileArtifactStore(resolve(dataDir, "objects")), close: () => db.close() };
}
