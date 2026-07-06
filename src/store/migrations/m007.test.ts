import { describe, expect, it } from "vitest";
import { Database } from "../database.js";

describe("M007 — agent_sessions ledger", () => {
  it("creates the agent_sessions table with all columns", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO agent_sessions
           (source_instance, session_id, content_hash, byte_size, line_count)
         VALUES ($1, $2, $3, $4, $5)`,
        ["claude-code", "sess-1", "hash-a", 1024, 42],
      );
      const row = await db.executor.query<{
        source_instance: string;
        session_id: string;
        content_hash: string;
        byte_size: number;
        line_count: number;
        state: string;
        retry_count: number;
        payload_id: number | null;
        staging_applied_at: string | null;
        prod_applied_at: string | null;
        discovered_at: string;
        updated_at: string;
      }>("SELECT * FROM agent_sessions WHERE session_id = $1", ["sess-1"]);
      expect(row.rows).toHaveLength(1);
      const r = row.rows[0];
      expect(r.source_instance).toBe("claude-code");
      expect(r.content_hash).toBe("hash-a");
      expect(r.byte_size).toBe(1024);
      expect(r.line_count).toBe(42);
      // defaults
      expect(r.state).toBe("discovered");
      expect(r.retry_count).toBe(0);
      // reserved columns, nullable
      expect(r.payload_id).toBeNull();
      expect(r.staging_applied_at).toBeNull();
      expect(r.prod_applied_at).toBeNull();
      expect(r.discovered_at).toBeTruthy();
      expect(r.updated_at).toBeTruthy();
    } finally {
      await db.executor.close();
    }
  });

  it("enforces a unique (source_instance, session_id, content_hash) revision key", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const insert = () =>
        db.executor.query(
          `INSERT INTO agent_sessions
             (source_instance, session_id, content_hash, byte_size, line_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_instance, session_id, content_hash) DO NOTHING`,
          ["codex", "sess-x", "hash-x", 10, 1],
        );
      await insert();
      await insert(); // conflict → no-op
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM agent_sessions WHERE session_id = $1",
        ["sess-x"],
      );
      expect(count.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("allows multiple revisions of the same session (different content_hash)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO agent_sessions (source_instance, session_id, content_hash, byte_size, line_count)
         VALUES ($1,$2,$3,$4,$5)`,
        ["hermes", "sess-r", "hash-1", 100, 5],
      );
      await db.executor.query(
        `INSERT INTO agent_sessions (source_instance, session_id, content_hash, byte_size, line_count)
         VALUES ($1,$2,$3,$4,$5)`,
        ["hermes", "sess-r", "hash-2", 200, 9],
      );
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM agent_sessions WHERE session_id = $1",
        ["sess-r"],
      );
      expect(count.rows[0].n).toBe(2);
    } finally {
      await db.executor.close();
    }
  });

  it("rejects an invalid state via the CHECK constraint", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await expect(
        db.executor.query(
          `INSERT INTO agent_sessions (source_instance, session_id, content_hash, byte_size, line_count, state)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          ["codex", "sess-bad", "hash-bad", 1, 1, "bogus_state"],
        ),
      ).rejects.toThrow();
    } finally {
      await db.executor.close();
    }
  });
});
