import type { SqlConn } from "./sql-executor.js";

export interface EmbeddingFingerprint {
  provider: string;
  model: string;
  dimensions: number;
}

export async function readMeta(conn: SqlConn, key: string): Promise<string | null> {
  const r = await conn.query<{ value: string }>(
    "SELECT value FROM memoark_meta WHERE key = $1",
    [key],
  );
  return r.rows[0]?.value ?? null;
}

export async function writeMeta(conn: SqlConn, key: string, value: string): Promise<void> {
  await conn.query(
    "INSERT INTO memoark_meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}

export function fingerprintString(fp: EmbeddingFingerprint): string {
  return `${fp.provider}:${fp.model}:${fp.dimensions}`;
}
