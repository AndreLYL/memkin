import { describe, expect, it } from "vitest";
import { Database } from "../database.js";

describe("M010 — distilled_payload outbox table", () => {
  it("creates the distilled_payload table with all columns", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO distilled_payload
           (source_instance, session_id, revision_id, content_hash, payload, restoration_map)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ["claude-code", "sess-1", 1, "hash-a", JSON.stringify({ signals: [] }), JSON.stringify({})],
      );
      const row = await db.executor.query<{
        id: number;
        source_instance: string;
        session_id: string;
        revision_id: number;
        content_hash: string;
        payload: unknown;
        restoration_map: unknown;
        ttl_expires_at: string | null;
        created_at: string;
      }>("SELECT * FROM distilled_payload WHERE session_id = $1", ["sess-1"]);
      expect(row.rows).toHaveLength(1);
      const r = row.rows[0];
      expect(r.source_instance).toBe("claude-code");
      expect(r.revision_id).toBe(1);
      expect(r.content_hash).toBe("hash-a");
      expect(r.payload).toBeTruthy();
      expect(r.ttl_expires_at).toBeNull();
      expect(r.created_at).toBeTruthy();
    } finally {
      await db.executor.close();
    }
  });

  it("enforces a unique revision_id (one payload per revision, immutable)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const insert = () =>
        db.executor.query(
          `INSERT INTO distilled_payload
             (source_instance, session_id, revision_id, content_hash, payload)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (revision_id) DO NOTHING`,
          ["codex", "sess-x", 7, "hash-x", JSON.stringify({ signals: [] })],
        );
      await insert();
      await insert();
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM distilled_payload WHERE revision_id = $1",
        [7],
      );
      expect(count.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("has an index for TTL sweeping", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const idx = await db.executor.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'distilled_payload'`,
      );
      const names = idx.rows.map((r) => r.indexname);
      expect(names).toContain("idx_distilled_payload_ttl");
    } finally {
      await db.executor.close();
    }
  });
});
