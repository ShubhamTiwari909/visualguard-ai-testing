/** SQLite is a zero-service local default; PostgreSQL uses the same normalized schema. */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type Value = string | number | null;
export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: Value[]): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vg_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vg_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES vg_projects(id),
    engine_run_id TEXT NOT NULL, digest TEXT NOT NULL, started_at TEXT NOT NULL,
    status TEXT NOT NULL, environment TEXT NOT NULL, branch TEXT NOT NULL,
    revision TEXT NOT NULL, pull_request INTEGER, deployment TEXT NOT NULL,
    document TEXT NOT NULL, search_text TEXT NOT NULL,
    UNIQUE(project_id, engine_run_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vg_jobs (
    run_id TEXT NOT NULL REFERENCES vg_runs(id), id TEXT NOT NULL,
    route TEXT NOT NULL, viewport TEXT NOT NULL, status TEXT NOT NULL,
    PRIMARY KEY(run_id, id)
  )`,
  "CREATE INDEX IF NOT EXISTS vg_runs_project_date ON vg_runs(project_id, started_at, id)",
  "CREATE INDEX IF NOT EXISTS vg_runs_status_date ON vg_runs(status, started_at, id)",
  "CREATE INDEX IF NOT EXISTS vg_runs_environment ON vg_runs(environment, started_at)",
  `CREATE TABLE IF NOT EXISTS vg_state (
    namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
    version INTEGER NOT NULL, expires_at TEXT, PRIMARY KEY(namespace, id)
  )`,
  `CREATE TABLE IF NOT EXISTS vg_object_chunks (
    hash TEXT NOT NULL, chunk INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(hash, chunk)
  )`,
  `CREATE TABLE IF NOT EXISTS vg_objects (
    hash TEXT PRIMARY KEY, size INTEGER NOT NULL, chunks INTEGER NOT NULL
  )`,
];

export async function openDatabase(options: { url?: string; sqlitePath: string }): Promise<Database> {
  let db: Database;
  if (options.url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: options.url, max: 5, connectionTimeoutMillis: 10_000 });
    const statement = (sql: string) => {
      let index = 0;
      return sql.replace(/\?/g, () => `$${++index}`);
    };
    db = {
      async query<T extends Record<string, unknown>>(sql: string, values: Value[] = []) {
        return (await pool.query(statement(sql), values)).rows as T[];
      },
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work({
            async query<T extends Record<string, unknown>>(sql: string, values: Value[] = []) {
              return (await client.query(statement(sql), values)).rows as T[];
            },
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      async close() { await pool.end(); },
    };
  } else {
    await mkdir(dirname(options.sqlitePath), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(options.sqlitePath);
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const query: Sql["query"] = async <T extends Record<string, unknown>>(sql: string, values: Value[] = []) =>
      sqlite.prepare(sql).all(...values) as T[];
    // Serialize every access, including reads, so no request observes an in-flight transaction.
    let pending: Promise<unknown> = Promise.resolve();
    const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
      const result = pending.then(work);
      pending = result.catch(() => {});
      return result;
    };
    db = {
      query: (sql, values) => exclusive(() => query(sql, values)),
      transaction: (work) => exclusive(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await work({ query });
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      }),
      close: () => exclusive(async () => { sqlite.close(); }),
    };
  }
  try {
    for (const sql of SCHEMA) await db.query(sql);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
