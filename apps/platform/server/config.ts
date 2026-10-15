import { dirname, resolve } from "node:path";
import { openDatabase } from "./database.js";
import { FallbackArtifactStore, FileArtifactStore, SqlArtifactStore } from "./artifacts.js";
import { Repository } from "./repository.js";
import { SqlStateStore } from "./state.js";

export async function openPlatform(env: NodeJS.ProcessEnv = process.env) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major! < 22 || (major === 22 && minor! < 12)) throw new Error("The dashboard requires Node.js 22.12 or newer. Switch your project to a supported Node version and retry.");
  const dataDir = resolve(env.VISUALGUARD_PLATFORM_DATA_DIR || (env.VISUALGUARD_SQLITE_FILE ? dirname(resolve(env.VISUALGUARD_SQLITE_FILE)) : resolve(env.INIT_CWD ?? process.cwd(), ".visualguard/platform")));
  const url = env.VISUALGUARD_DATABASE_URL ?? env.DATABASE_URL;
  if (url?.startsWith("mongodb")) {
    const { openMongo } = await import("./mongo.js");
    return openMongo(url);
  }
  if (url && !/^postgres(?:ql)?:\/\//.test(url)) throw new Error("Database URL must use postgresql://, postgres://, mongodb:// or mongodb+srv://");
  const db = await openDatabase({ url, sqlitePath: env.VISUALGUARD_SQLITE_FILE ? resolve(env.VISUALGUARD_SQLITE_FILE) : resolve(dataDir, "metadata.sqlite") });
  const legacy = new FileArtifactStore(resolve(dataDir, "objects"));
  return { repository: new Repository(db, legacy), state: new SqlStateStore(db), store: new FallbackArtifactStore(new SqlArtifactStore(db), legacy), close: () => db.close() };
}
