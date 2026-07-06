// src/store/pglite-executor.ts
import { PGlite } from "@electric-sql/pglite";
import { acquireLock, type LockHandle } from "./data-dir-lock.js";
import { buildPGliteOptions } from "./pglite-assets.js";
import type { SqlConn, SqlExecutor } from "./sql-executor.js";

export class PgliteExecutor implements SqlExecutor {
  private constructor(
    private readonly pg: PGlite,
    private readonly lock?: LockHandle,
  ) {}

  static async create(
    dataDir: string | undefined,
    opts: { assetsOverride?: string; lockLabel?: string },
  ): Promise<PgliteExecutor> {
    // Build PGlite FIRST — if WASM/asset loading fails, no lock is leaked.
    const pg = new PGlite(
      await buildPGliteOptions(dataDir, { assetsOverride: opts.assetsOverride }),
    );
    let lock: LockHandle | undefined;
    try {
      if (dataDir && !process.env.MEMKIN_NO_LOCK) {
        lock = acquireLock(dataDir, opts.lockLabel ?? "memkin");
      }
      return new PgliteExecutor(pg, lock);
    } catch (e) {
      lock?.release();
      await pg.close();
      throw e;
    }
  }

  /** Expose the raw PGlite instance (e.g. for extension access). */
  get raw(): PGlite {
    return this.pg;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }> {
    return this.pg.query<T>(sql, params);
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlConn) => Promise<T>): Promise<T> {
    return this.pg.transaction<T>(async (pgTx) => {
      const conn: SqlConn = {
        query: <R = Record<string, unknown>>(s: string, p?: unknown[]) => pgTx.query<R>(s, p),
        exec: async (s: string) => {
          await pgTx.exec(s);
        },
      };
      return fn(conn);
    });
  }

  async bootstrap(fn: (conn: SqlConn) => Promise<void>): Promise<void> {
    await fn(this);
  }

  async close(): Promise<void> {
    try {
      await this.pg.close();
    } finally {
      this.lock?.release();
    }
  }
}
