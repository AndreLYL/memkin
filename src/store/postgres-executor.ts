import { Pool, type PoolClient } from "pg";
import { maskDatabaseUrl } from "../config-center/secrets.js";
import type { Config } from "../core/config.js";
import { MEMKIN_LOCK_KEY, type SqlConn, type SqlExecutor } from "./sql-executor.js";

function connAdapter(c: PoolClient): SqlConn {
  return {
    query: async (s, p) => ({ rows: (await c.query(s, p as unknown[])).rows }),
    exec: async (s) => {
      await c.query(s);
    },
  };
}

export class PostgresExecutor implements SqlExecutor {
  private constructor(
    private readonly pool: Pool,
    private readonly maskedUrl: string = "",
  ) {
    pool.on("error", (e) =>
      console.error("[memkin] pg pool error:", e.message, `(url: ${this.maskedUrl})`),
    );
  }

  static async create(config: Config): Promise<PostgresExecutor> {
    const url = config.store?.database_url;
    if (!url) throw new Error("store.database_url is required when engine=postgres");
    const pool = new Pool({
      connectionString: url,
      max: config.store?.pool_size ?? 10,
      connectionTimeoutMillis: 10_000,
    });
    // Capture masked URL for safe error logging (password never appears in logs)
    const maskedUrl = maskDatabaseUrl(url);
    return new PostgresExecutor(pool, maskedUrl);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    const r = await this.pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: SqlConn) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(connAdapter(c));
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async bootstrap(fn: (conn: SqlConn) => Promise<void>): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("SELECT pg_advisory_lock($1::bigint)", [MEMKIN_LOCK_KEY.toString()]);
      try {
        await fn(connAdapter(c));
      } finally {
        await c
          .query("SELECT pg_advisory_unlock($1::bigint)", [MEMKIN_LOCK_KEY.toString()])
          .catch(() => {});
      }
    } finally {
      c.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
