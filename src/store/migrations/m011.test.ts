import { describe, expect, it } from "vitest";
import { Database } from "../database.js";

describe("M011 — apply engine tables (contributions + apply_plan + apply_attempt)", () => {
  it("creates memory_contributions with the two-layer ID columns", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO pages (slug, type, title) VALUES ('decisions/foo', 'decision', 'Foo')`,
      );
      const pageId = (
        await db.executor.query<{ id: number }>(
          "SELECT id FROM pages WHERE slug = 'decisions/foo'",
        )
      ).rows[0].id;

      await db.executor.query(
        `INSERT INTO memory_contributions
           (contribution_id, signal_family_key, canonical_page_id, session_ref,
            revision_id, authority, signal_type, normalized_topic, signal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          "cid-1",
          "fam-1",
          pageId,
          "claude-code:sess-1",
          1,
          "user_confirmed",
          "decision",
          "foo",
          JSON.stringify({ what: "chose foo" }),
        ],
      );
      const row = await db.executor.query<{ active: boolean; canonical_page_id: number }>(
        "SELECT active, canonical_page_id FROM memory_contributions WHERE contribution_id = 'cid-1'",
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].active).toBe(true);
      expect(row.rows[0].canonical_page_id).toBe(pageId);
    } finally {
      await db.executor.close();
    }
  });

  it("enforces UNIQUE (signal_family_key, revision_id)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const insert = (cid: string) =>
        db.executor.query(
          `INSERT INTO memory_contributions
             (contribution_id, signal_family_key, canonical_page_id, session_ref,
              revision_id, authority, signal_type, normalized_topic, signal)
           VALUES ($1, 'fam-x', NULL, 'sref', 7, 'user_confirmed', 'task', 'x', '{}'::jsonb)`,
          [cid],
        );
      await insert("cid-a");
      await expect(insert("cid-b")).rejects.toThrow();
    } finally {
      await db.executor.close();
    }
  });

  it("enforces contribution_id as the primary key", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const insert = (fam: string, rev: number) =>
        db.executor.query(
          `INSERT INTO memory_contributions
             (contribution_id, signal_family_key, canonical_page_id, session_ref,
              revision_id, authority, signal_type, normalized_topic, signal)
           VALUES ('dup-cid', $1, NULL, 'sref', $2, 'user_confirmed', 'task', 'x', '{}'::jsonb)`,
          [fam, rev],
        );
      await insert("fam-1", 1);
      await expect(insert("fam-2", 2)).rejects.toThrow();
    } finally {
      await db.executor.close();
    }
  });

  it("creates apply_plan with UNIQUE (payload_id, target)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO distilled_payload
             (source_instance, session_id, revision_id, content_hash, payload)
           VALUES ('claude-code', 'sess-1', 1, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
        )
      ).rows[0].id;

      const insert = () =>
        db.executor.query(
          `INSERT INTO apply_plan (payload_id, target, plan)
           VALUES ($1, 'production', '{"decisions":[]}'::jsonb)`,
          [payloadId],
        );
      await insert();
      await expect(insert()).rejects.toThrow();

      // staging plan for the same payload is a distinct row.
      await db.executor.query(
        `INSERT INTO apply_plan (payload_id, target, plan)
         VALUES ($1, 'staging', '{"decisions":[]}'::jsonb)`,
        [payloadId],
      );
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM apply_plan WHERE payload_id = $1",
        [payloadId],
      );
      expect(count.rows[0].n).toBe(2);
    } finally {
      await db.executor.close();
    }
  });

  it("rejects an invalid target on apply_plan and apply_attempt", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO distilled_payload
             (source_instance, session_id, revision_id, content_hash, payload)
           VALUES ('claude-code', 'sess-2', 2, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
        )
      ).rows[0].id;
      await expect(
        db.executor.query(
          `INSERT INTO apply_plan (payload_id, target, plan) VALUES ($1, 'bogus', '{}'::jsonb)`,
          [payloadId],
        ),
      ).rejects.toThrow();
    } finally {
      await db.executor.close();
    }
  });

  it("creates apply_attempt linked to a plan with a status check", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO distilled_payload
             (source_instance, session_id, revision_id, content_hash, payload)
           VALUES ('claude-code', 'sess-3', 3, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
        )
      ).rows[0].id;
      const planId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO apply_plan (payload_id, target, plan)
           VALUES ($1, 'production', '{}'::jsonb) RETURNING id`,
          [payloadId],
        )
      ).rows[0].id;
      const attemptId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO apply_attempt (plan_id, target, status)
           VALUES ($1, 'production', 'applied') RETURNING id`,
          [planId],
        )
      ).rows[0].id;
      expect(attemptId).toBeGreaterThan(0);

      await expect(
        db.executor.query(
          `INSERT INTO apply_attempt (plan_id, target, status) VALUES ($1, 'production', 'nope')`,
          [planId],
        ),
      ).rejects.toThrow();
    } finally {
      await db.executor.close();
    }
  });

  it("creates apply_mutation_journal keyed per attempt+seq", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO distilled_payload
             (source_instance, session_id, revision_id, content_hash, payload)
           VALUES ('claude-code', 'sess-4', 4, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
        )
      ).rows[0].id;
      const planId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO apply_plan (payload_id, target, plan)
           VALUES ($1, 'production', '{}'::jsonb) RETURNING id`,
          [payloadId],
        )
      ).rows[0].id;
      const attemptId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO apply_attempt (plan_id, target) VALUES ($1, 'production') RETURNING id`,
          [planId],
        )
      ).rows[0].id;
      const ins = () =>
        db.executor.query(
          `INSERT INTO apply_mutation_journal (apply_attempt_id, seq, kind, inverse)
           VALUES ($1, 1, 'page_insert', '{"slug":"x"}'::jsonb)`,
          [attemptId],
        );
      await ins();
      await expect(ins()).rejects.toThrow();
    } finally {
      await db.executor.close();
    }
  });
});
