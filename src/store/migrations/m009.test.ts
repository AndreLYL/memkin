import { describe, expect, it } from "vitest";
import { Database } from "../database.js";

describe("M009 — entity_merge_suggestions", () => {
  it("creates the table with all columns and defaults", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO entity_merge_suggestions (entity_type, from_slug, into_slug, reason, detail)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        ["tool", "tool/lark-cli-http-client", "tool/larkclihttpclient", "same_name", "{}"],
      );
      const row = await db.executor.query<{
        entity_type: string;
        from_slug: string;
        into_slug: string;
        reason: string;
        status: string;
        created_at: string;
        resolved_at: string | null;
      }>("SELECT * FROM entity_merge_suggestions");
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].status).toBe("pending");
      expect(row.rows[0].resolved_at).toBeNull();
      expect(row.rows[0].created_at).toBeTruthy();
    } finally {
      await db.close();
    }
  });

  it("enforces unique (entity_type, from_slug, into_slug, reason)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const insert = () =>
        db.executor.query(
          `INSERT INTO entity_merge_suggestions (entity_type, from_slug, into_slug, reason)
           VALUES ('project', 'project/a', 'project/b', 'levenshtein')
           ON CONFLICT (entity_type, from_slug, into_slug, reason) DO NOTHING`,
        );
      await insert();
      await insert();
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM entity_merge_suggestions",
      );
      expect(count.rows[0].n).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("rejects invalid reason and status values via CHECK constraints", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await expect(
        db.executor.query(
          `INSERT INTO entity_merge_suggestions (entity_type, from_slug, into_slug, reason)
           VALUES ('tool', 'tool/a', 'tool/b', 'gut_feeling')`,
        ),
      ).rejects.toThrow();
      await expect(
        db.executor.query(
          `INSERT INTO entity_merge_suggestions (entity_type, from_slug, into_slug, reason, status)
           VALUES ('tool', 'tool/a', 'tool/b', 'same_name', 'maybe')`,
        ),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
