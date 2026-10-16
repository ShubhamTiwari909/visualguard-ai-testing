import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { Pool } from "pg";
import { openDatabase, type Database } from "../../server/database.js";
import { openMongo } from "../../server/mongo.js";
import { Repository } from "../../server/repository.js";
import { SqlStateStore } from "../../server/state.js";

/** Own only this suite's random schema/database; never delete the configured database. */
export async function isolatedStorage(backend: "postgres" | "mongo", url: string) {
  const name = `vg_test_${randomUUID().replaceAll("-", "")}`;
  if (backend === "mongo") {
    const target = new URL(url);
    if (target.username && !target.searchParams.has("authSource"))
      target.searchParams.set(
        "authSource",
        decodeURIComponent(target.pathname.slice(1)) || "admin",
      );
    target.pathname = `/${name}`;
    const result = await openMongo(target.href);
    return {
      ...result,
      close: async () => {
        try {
          await result.close();
        } finally {
          const cleanup = new MongoClient(target.href);
          try {
            await cleanup.connect();
            await cleanup.db(name).dropDatabase();
          } finally {
            await cleanup.close();
          }
        }
      },
    };
  }
  const control = new Pool({ connectionString: url, max: 1 });
  let created = false,
    db: Database | undefined;
  const close = async () => {
    try {
      await db?.close();
    } finally {
      try {
        if (created) await control.query(`DROP SCHEMA "${name}" CASCADE`);
      } finally {
        await control.end();
      }
    }
  };
  try {
    await control.query(`CREATE SCHEMA "${name}"`);
    created = true;
    const target = new URL(url);
    target.searchParams.set(
      "options",
      `${target.searchParams.get("options") ?? ""} -c search_path=${name}`.trim(),
    );
    db = await openDatabase({ url: target.href, sqlitePath: "unused" });
    return { state: new SqlStateStore(db), repository: new Repository(db), close };
  } catch (error) {
    await close();
    throw error;
  }
}
