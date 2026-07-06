import type { SqlConn } from "./sql-executor.js";

// Tables from schema.sql whose `id` is SERIAL. An id-preserving import/restore
// (explicit-id INSERTs with no setval) leaves the backing sequence behind
// MAX(id); nextval then returns an already-used id and every new-row INSERT
// dies on the table's pkey — the slug-targeted ON CONFLICT cannot arbitrate a
// pkey collision. Each failed INSERT still consumes a sequence value, so the
// symptom is "fails N times, then self-heals", which is why it goes unnoticed.
const SERIAL_ID_TABLES = ["pages", "content_chunks", "links", "tags", "timeline_entries"] as const;

export interface SequenceDesync {
  table: string;
  /** Backing sequence relation, as reported by pg_get_serial_sequence. */
  sequence: string;
  maxId: number;
  /** What nextval would have returned before repair (≤ maxId ⇒ collision). */
  nextValue: number;
}

/**
 * Report every SERIAL id sequence whose next value would collide with an
 * existing row. Read-only; missing tables are skipped so this is safe to run
 * against a not-yet-initialized database (doctor).
 */
export async function detectIdSequenceDesync(conn: SqlConn): Promise<SequenceDesync[]> {
  const out: SequenceDesync[] = [];
  for (const table of SERIAL_ID_TABLES) {
    const seqRes = await conn.query<{ seq: string | null }>(
      "SELECT pg_get_serial_sequence(t.oid::regclass::text, 'id') AS seq FROM pg_class t WHERE t.oid = to_regclass($1)",
      [table],
    );
    const sequence = seqRes.rows[0]?.seq;
    if (!sequence) continue; // table absent or id is not serial-backed

    const stateRes = await conn.query<{ last_value: string | number; is_called: boolean }>(
      `SELECT last_value, is_called FROM ${sequence}`,
    );
    const maxRes = await conn.query<{ max_id: number | null }>(
      `SELECT MAX(id) AS max_id FROM ${table}`,
    );
    const maxId = maxRes.rows[0]?.max_id ?? 0;
    if (maxId === 0) continue; // empty table — nothing to collide with

    const lastValue = Number(stateRes.rows[0].last_value);
    const nextValue = stateRes.rows[0].is_called ? lastValue + 1 : lastValue;
    if (maxId >= nextValue) {
      out.push({ table, sequence, maxId, nextValue });
    }
  }
  return out;
}

/**
 * Repair every desynced sequence so nextval returns MAX(id)+1. Idempotent and
 * strictly forward-moving: healthy sequences are never touched. Returns the
 * repairs performed (empty when the store is healthy).
 */
export async function resyncIdSequences(conn: SqlConn): Promise<SequenceDesync[]> {
  const desynced = await detectIdSequenceDesync(conn);
  for (const d of desynced) {
    // setval(..., false): next nextval returns exactly maxId + 1.
    await conn.query("SELECT setval($1::regclass, $2, false)", [d.sequence, d.maxId + 1]);
  }
  return desynced;
}
