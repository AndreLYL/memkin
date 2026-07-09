import { describe, expect, it } from "vitest";
import { Database } from "../store/database.js";
import { PageStore } from "../store/pages.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import { AUTO_BEGIN, AUTO_END } from "./page-content.js";
import { rematerializeCanonicalPage } from "./rematerialize.js";

async function seedPage(
  db: { executor: SqlExecutor },
  slug: string,
  content: string,
): Promise<number> {
  const pages = new PageStore(db.executor);
  const p = await pages.putPage(slug, content);
  return p.id;
}

async function addContribution(
  db: { executor: SqlExecutor },
  pageId: number,
  cid: string,
  fam: string,
  opts: {
    what: string;
    why?: string;
    authority?: string;
    type?: string;
    active?: boolean;
    sourceRef?: Record<string, unknown>;
    entities?: string[];
  },
): Promise<void> {
  await db.executor.query(
    `INSERT INTO memory_contributions
       (contribution_id, signal_family_key, canonical_page_id, session_ref, revision_id,
        authority, signal_type, normalized_topic, signal, source_ref, active)
     VALUES ($1, $2, $3, 'claude-code:sess-1', 1, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      cid,
      fam,
      pageId,
      opts.authority ?? "user_confirmed",
      opts.type ?? "decision",
      cid,
      JSON.stringify({ what: opts.what, why: opts.why, entities: opts.entities ?? [] }),
      opts.sourceRef ? JSON.stringify(opts.sourceRef) : null,
      opts.active ?? true,
    ],
  );
}

describe("rematerializeCanonicalPage", () => {
  it("renders the system-managed body from active contributions, preserving user content", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pageId = await seedPage(
        db,
        "decisions/db",
        "---\ntitle: DB choice\ntype: decision\n---\nUser hand-edited intro.",
      );
      await addContribution(db, pageId, "c1", "f1", {
        what: "Adopt Postgres",
        why: "durability",
        authority: "user_confirmed",
      });
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));

      const page = await new PageStore(db.executor).getPage("decisions/db");
      expect(page?.compiled_truth).toContain("User hand-edited intro.");
      expect(page?.compiled_truth).toContain(AUTO_BEGIN);
      expect(page?.compiled_truth).toContain(AUTO_END);
      expect(page?.compiled_truth).toContain("Adopt Postgres");
      expect(page?.compiled_truth).toContain("durability");
    } finally {
      await db.executor.close();
    }
  });

  it("no longer shows a withdrawn contribution's conclusion after rematerialize", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pageId = await seedPage(db, "decisions/x", "---\ntitle: X\ntype: decision\n---\nintro");
      await addContribution(db, pageId, "keep", "fk", { what: "Keep this" });
      await addContribution(db, pageId, "drop", "fd", { what: "Old conclusion" });
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));

      let page = await new PageStore(db.executor).getPage("decisions/x");
      expect(page?.compiled_truth).toContain("Old conclusion");

      // Withdraw the second contribution and rematerialize again.
      await db.executor.query(
        "UPDATE memory_contributions SET active = false WHERE contribution_id = 'drop'",
      );
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));

      page = await new PageStore(db.executor).getPage("decisions/x");
      expect(page?.compiled_truth).toContain("Keep this");
      expect(page?.compiled_truth).not.toContain("Old conclusion");
    } finally {
      await db.executor.close();
    }
  });

  it("derives the primary source (first user_confirmed) into frontmatter", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pageId = await seedPage(db, "decisions/s", "---\ntitle: S\ntype: decision\n---\n");
      await addContribution(db, pageId, "a", "fa", {
        what: "assistant claim",
        authority: "assistant_claimed",
        type: "knowledge",
        sourceRef: { platform: "feishu", channel: "c1", timestamp: "2026-07-01T00:00:00.000Z" },
      });
      await addContribution(db, pageId, "u", "fu", {
        what: "user confirmed",
        authority: "user_confirmed",
        sourceRef: {
          platform: "claude-code",
          channel: "c2",
          timestamp: "2026-07-02T00:00:00.000Z",
        },
      });
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));

      const page = await new PageStore(db.executor).getPage("decisions/s");
      const source = page?.frontmatter.source as Record<string, unknown> | undefined;
      expect(source?.platform).toBe("claude-code");
    } finally {
      await db.executor.close();
    }
  });

  it("rebuilds derived timeline entries with auto provenance", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pageId = await seedPage(db, "decisions/t", "---\ntitle: T\ntype: decision\n---\n");
      await addContribution(db, pageId, "t1", "ft", {
        what: "Timeline worthy",
        sourceRef: { platform: "claude-code", channel: "c", timestamp: "2026-07-03T00:00:00.000Z" },
      });
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));

      const rows = await db.executor.query<{ summary: string; auto: string | null }>(
        `SELECT summary, provenance->>'auto' AS auto FROM timeline_entries WHERE page_id = $1`,
        [pageId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].summary).toBe("Timeline worthy");
      expect(rows.rows[0].auto).toBe("contribution");

      // Withdraw → rematerialize clears the derived timeline entry.
      await db.executor.query(
        "UPDATE memory_contributions SET active = false WHERE canonical_page_id = $1",
        [pageId],
      );
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));
      const after = await db.executor.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM timeline_entries WHERE page_id = $1`,
        [pageId],
      );
      expect(after.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("marks a page orphaned (not deleted) when it loses all active contributions", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pageId = await seedPage(db, "decisions/o", "---\ntitle: O\ntype: decision\n---\nintro");
      await addContribution(db, pageId, "only", "fo", { what: "sole conclusion" });
      await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));
      await db.executor.query(
        "UPDATE memory_contributions SET active = false WHERE canonical_page_id = $1",
        [pageId],
      );

      const result = await db.executor.transaction((tx) => rematerializeCanonicalPage(tx, pageId));
      expect(result.orphaned).toBe(true);

      const page = await new PageStore(db.executor).getPage("decisions/o");
      expect(page).not.toBeNull(); // NOT deleted
      expect(page?.frontmatter.orphaned).toBe(true);
      expect(page?.compiled_truth).not.toContain("sole conclusion");
      expect(page?.compiled_truth).toContain("intro"); // user content preserved
    } finally {
      await db.executor.close();
    }
  });
});
