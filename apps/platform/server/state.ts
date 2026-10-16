import type { Database, Sql } from "./database.js";
import type { StateRecord, StateStore } from "./storage-contracts.js";

type Row = { id: string; value: string; version: number; expires_at: string | null };
const record = <T>(row: Row): StateRecord<T> => ({
  id: row.id,
  value: JSON.parse(row.value) as T,
  version: row.version,
  expiresAt: row.expires_at ?? undefined,
});

export class SqlStateStore implements StateStore {
  constructor(
    private db: Database,
    private sql: Sql = db,
    private inTransaction = false,
  ) {}
  async supportsTransactions() {
    return true;
  }
  async transaction<T>(work: (store: StateStore) => Promise<T>): Promise<T> {
    if (this.inTransaction) return work(this);
    return this.db.transaction((sql) => work(new SqlStateStore(this.db, sql, true)));
  }
  private atomic<T>(work: (sql: Sql) => Promise<T>) {
    return this.inTransaction ? work(this.sql) : this.db.transaction(work);
  }
  async get<T>(namespace: string, id: string) {
    const [row] = await this.sql.query<Row>(
      "SELECT id, value, version, expires_at FROM vg_state WHERE namespace=? AND id=? AND (expires_at IS NULL OR expires_at>?)",
      [namespace, id, new Date().toISOString()],
    );
    return row ? record<T>(row) : undefined;
  }
  async create<T>(namespace: string, id: string, value: T, expiresAt?: string) {
    return this.atomic(async (sql) => {
      await sql.query(
        "DELETE FROM vg_state WHERE namespace=? AND id=? AND expires_at IS NOT NULL AND expires_at<=?",
        [namespace, id, new Date().toISOString()],
      );
      return (
        (
          await sql.query(
            "INSERT INTO vg_state(namespace, id, value, version, expires_at) VALUES(?, ?, ?, 1, ?) ON CONFLICT(namespace, id) DO NOTHING RETURNING id",
            [namespace, id, JSON.stringify(value), expiresAt ?? null],
          )
        ).length === 1
      );
    });
  }
  async replace<T>(namespace: string, item: StateRecord<T>) {
    return (
      (
        await this.sql.query(
          "UPDATE vg_state SET value=?, version=version+1, expires_at=? WHERE namespace=? AND id=? AND version=? AND (expires_at IS NULL OR expires_at>?) RETURNING id",
          [
            JSON.stringify(item.value),
            item.expiresAt ?? null,
            namespace,
            item.id,
            item.version,
            new Date().toISOString(),
          ],
        )
      ).length === 1
    );
  }
  async remove(namespace: string, id: string, version?: number) {
    return (
      (
        await this.sql.query(
          `DELETE FROM vg_state WHERE namespace=? AND id=?${version === undefined ? "" : " AND version=?"} RETURNING id`,
          version === undefined ? [namespace, id] : [namespace, id, version],
        )
      ).length === 1
    );
  }
  async list<T>(namespace: string, prefix = "", limit = 1000, after?: string) {
    const escaped = prefix.replace(/[!%_]/g, (value) => `!${value}`);
    const rows = await this.sql.query<Row>(
      `SELECT id, value, version, expires_at FROM vg_state WHERE namespace=? AND id LIKE ? ESCAPE '!'${after === undefined ? "" : " AND id>?"} AND (expires_at IS NULL OR expires_at>?) ORDER BY id LIMIT ?`,
      [
        namespace,
        `${escaped}%`,
        ...(after === undefined ? [] : [after]),
        new Date().toISOString(),
        limit,
      ],
    );
    return rows.map(record<T>);
  }
  async pruneExpired(limit = 250) {
    return (
      await this.sql.query(
        "DELETE FROM vg_state WHERE (namespace, id) IN (SELECT namespace, id FROM vg_state WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT ?) RETURNING id",
        [new Date().toISOString(), limit],
      )
    ).length;
  }
}
