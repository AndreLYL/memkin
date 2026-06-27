import type { Config } from "../core/config.js";
import type { SqlConn, SqlExecutor } from "./sql-executor.js";

/** STUB — full implementation in a later task. */
export class PostgresExecutor implements SqlExecutor {
  private constructor() {}

  static async create(_config: Config): Promise<PostgresExecutor> {
    throw new Error("PostgresExecutor not implemented yet");
  }

  async query<T = Record<string, unknown>>(
    _sql: string,
    _params?: unknown[],
  ): Promise<{ rows: T[] }> {
    throw new Error("not implemented");
  }

  async exec(_sql: string): Promise<void> {
    throw new Error("not implemented");
  }

  async transaction<T>(_fn: (tx: SqlConn) => Promise<T>): Promise<T> {
    throw new Error("not implemented");
  }

  async bootstrap(_fn: (conn: SqlConn) => Promise<void>): Promise<void> {
    throw new Error("not implemented");
  }

  async close(): Promise<void> {
    throw new Error("not implemented");
  }
}
