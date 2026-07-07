// src/store/distilled-payload.ts
//
// DistilledPayloadStore — the distillation OUTBOX (spec §5, §6.2, §4.3).
//
// Holds the target-agnostic, immutable distilled payload for each session
// revision. PR-2 writes here (after validation + second-pass privacy) and
// advances the ledger discovered→distilled; PR-4's apply engine later reads it
// to build target-specific apply plans. The payload is never mutated after
// insert (unique revision_id), so "retry" only ever replays it — the LLM is
// never called again once a payload exists.
//
// TTL: after a session reaches `done`, the payload is retained for
// distiller.payload_ttl_days (default 90) via ttl_expires_at; the consolidator
// calls sweepExpired() to clear payload + reversible restoration map together
// (spec §4.3).

import type { DistilledPayload } from "../distiller/contract.js";
import type { RestorationMap } from "../distiller/raw-privacy.js";
import type { SqlConn } from "./sql-executor.js";

export interface PersistPayloadInput {
  sourceInstance: string;
  sessionId: string;
  revisionId: number;
  contentHash: string;
  payload: DistilledPayload;
  restorationMap: RestorationMap;
}

export interface StoredPayload {
  id: number;
  sourceInstance: string;
  sessionId: string;
  revisionId: number;
  contentHash: string;
  payload: DistilledPayload;
  restorationMap: RestorationMap | null;
  ttlExpiresAt: string | null;
  createdAt: string;
}

interface PayloadRow {
  id: number;
  source_instance: string;
  session_id: string;
  revision_id: number;
  content_hash: string;
  payload: DistilledPayload | string;
  restoration_map: RestorationMap | string | null;
  ttl_expires_at: string | null;
  created_at: string;
}

function parseJson<T>(v: T | string | null): T | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? (JSON.parse(v) as T) : v;
}

function rowToStored(row: PayloadRow): StoredPayload {
  return {
    id: row.id,
    sourceInstance: row.source_instance,
    sessionId: row.session_id,
    revisionId: row.revision_id,
    contentHash: row.content_hash,
    payload: parseJson<DistilledPayload>(row.payload) as DistilledPayload,
    restorationMap: parseJson<RestorationMap>(row.restoration_map),
    ttlExpiresAt: row.ttl_expires_at,
    createdAt: row.created_at,
  };
}

export class DistilledPayloadStore {
  constructor(private readonly pg: SqlConn) {}

  /**
   * Persist a validated payload (immutable per revision) and advance the ledger
   * to `distilled`, linking payload_id. Idempotent: replaying the same revision
   * returns the existing row without re-inserting and without any LLM call.
   */
  async persist(input: PersistPayloadInput): Promise<StoredPayload> {
    const inserted = await this.pg.query<PayloadRow>(
      `INSERT INTO distilled_payload
         (source_instance, session_id, revision_id, content_hash, payload, restoration_map)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (revision_id) DO NOTHING
       RETURNING *`,
      [
        input.sourceInstance,
        input.sessionId,
        input.revisionId,
        input.contentHash,
        JSON.stringify(input.payload),
        JSON.stringify(input.restorationMap ?? {}),
      ],
    );

    let stored: StoredPayload;
    if (inserted.rows.length > 0) {
      stored = rowToStored(inserted.rows[0]);
      // Link + advance the ledger. discovered→distilled is a legal transition;
      // we set state and payload_id in one update. If the revision is already
      // past discovered (e.g. re-run), leave state alone but ensure the link.
      await this.pg.query(
        `UPDATE agent_sessions
           SET payload_id = $2,
               state = CASE WHEN state = 'discovered' THEN 'distilled' ELSE state END,
               updated_at = NOW()
         WHERE id = $1`,
        [input.revisionId, stored.id],
      );
    } else {
      const existing = await this.pg.query<PayloadRow>(
        "SELECT * FROM distilled_payload WHERE revision_id = $1",
        [input.revisionId],
      );
      stored = rowToStored(existing.rows[0]);
    }
    return stored;
  }

  async getByRevision(revisionId: number): Promise<StoredPayload | null> {
    const r = await this.pg.query<PayloadRow>(
      "SELECT * FROM distilled_payload WHERE revision_id = $1",
      [revisionId],
    );
    return r.rows[0] ? rowToStored(r.rows[0]) : null;
  }

  async getById(id: number): Promise<StoredPayload | null> {
    const r = await this.pg.query<PayloadRow>("SELECT * FROM distilled_payload WHERE id = $1", [
      id,
    ]);
    return r.rows[0] ? rowToStored(r.rows[0]) : null;
  }

  /** Stamp ttl_expires_at = now + ttlDays (call once the session reaches `done`). */
  async setTtl(id: number, ttlDays: number): Promise<void> {
    await this.pg.query(
      `UPDATE distilled_payload
         SET ttl_expires_at = NOW() + ($2 || ' days')::interval
       WHERE id = $1`,
      [id, String(ttlDays)],
    );
  }

  /**
   * Stamp ttl_expires_at for every payload whose session revision has reached
   * `done` and that has no TTL yet (spec §4.3: payload retained N days after
   * done). Called by the consolidator's cleanup hook. Idempotent — already
   * stamped rows are skipped. Returns the number of payloads stamped.
   */
  async stampTtlForDoneSessions(ttlDays: number): Promise<number> {
    const r = await this.pg.query<{ id: number }>(
      `UPDATE distilled_payload
         SET ttl_expires_at = NOW() + ($1 || ' days')::interval
       WHERE ttl_expires_at IS NULL
         AND revision_id IN (SELECT id FROM agent_sessions WHERE state = 'done')
       RETURNING id`,
      [String(ttlDays)],
    );
    return r.rows.length;
  }

  /**
   * Delete payloads whose TTL has passed. The reversible restoration_map is a
   * column on the same row, so it is cleared together (spec §4.3). Returns the
   * number of rows swept.
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const r = await this.pg.query<{ id: number }>(
      `DELETE FROM distilled_payload
       WHERE ttl_expires_at IS NOT NULL AND ttl_expires_at <= $1
       RETURNING id`,
      [now.toISOString()],
    );
    return r.rows.length;
  }
}
