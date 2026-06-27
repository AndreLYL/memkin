// src/store/sql-executor.ts
/** 查询面：13 个生产类的 .query / 偶尔 .exec 都走它；transaction/bootstrap 回调也用它。 */
export interface SqlConn {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>; // 多语句、无参，仅 schema/迁移
}

export interface SqlExecutor extends SqlConn {
  /** 原子多步（merge / put_page）。回调内全部用 tx，不要混用外层 conn。 */
  transaction<T>(fn: (tx: SqlConn) => Promise<T>): Promise<T>;
  /** 单连接 + 引擎锁内跑 schema/迁移/dims；Postgres 用 advisory lock，PGLite 用 data-dir 锁。 */
  bootstrap(fn: (conn: SqlConn) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** Postgres advisory lock 的固定 key（任意稳定 bigint）。 */
export const MEMOARK_LOCK_KEY = 0x6d656d6f31n; // "memo1"
