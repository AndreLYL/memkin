import { describe, expect, it } from "vitest";
import { Database } from "../database.js";
import { PageStore } from "../pages.js";
import { SearchEngine } from "../search.js";

async function columnNames(
  db: Awaited<ReturnType<typeof Database.create>>,
  schema: string,
  table: string,
): Promise<string[]> {
  const r = await db.executor.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, table],
  );
  return r.rows.map((x) => x.column_name);
}

describe("M012 — staging schema (physical isolation)", () => {
  it("creates a staging schema with tables isomorphic to production", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const tables = [
        "pages",
        "content_chunks",
        "links",
        "tags",
        "timeline_entries",
        "memory_contributions",
      ];
      for (const t of tables) {
        const pub = await columnNames(db, "public", t);
        const stg = await columnNames(db, "staging", t);
        expect(stg.length).toBeGreaterThan(0);
        expect(stg).toEqual(pub);
      }
    } finally {
      await db.executor.close();
    }
  });

  it("keeps staging rows out of production reads (zero pollution)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      // A production page that should be found.
      const pages = new PageStore(db.executor);
      await pages.putPage(
        "decisions/prod-only",
        "---\ntitle: Prod Only\ntype: decision\n---\nWe picked postgres for durability.",
      );

      // A staging page with overlapping keywords — must NOT surface in production.
      await db.executor.query(
        `INSERT INTO staging.pages (slug, type, title, compiled_truth, content_hash)
         VALUES ('decisions/staging-only', 'decision', 'Staging Only',
                 'We picked postgres in the shadow run.', 'stg-hash')`,
      );

      const search = new SearchEngine(db.executor);
      const results = await search.search("postgres");
      const slugs = results.map((r) => r.slug);
      expect(slugs).toContain("decisions/prod-only");
      expect(slugs).not.toContain("decisions/staging-only");

      // listPages (production) must not see the staging row either.
      const listed = (await pages.listPages()).map((p) => p.slug);
      expect(listed).toContain("decisions/prod-only");
      expect(listed).not.toContain("decisions/staging-only");

      // The staging row really is there under its own schema.
      const stg = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM staging.pages",
      );
      expect(stg.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("routes unqualified writes to staging when search_path is set (single-engine target switch)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.transaction(async (tx) => {
        await tx.query("SET LOCAL search_path TO staging, public");
        await tx.query(
          `INSERT INTO pages (slug, type, title, content_hash)
           VALUES ('decisions/via-path', 'decision', 'Via Path', 'h')`,
        );
      });
      const inStaging = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM staging.pages WHERE slug = 'decisions/via-path'",
      );
      const inPublic = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.pages WHERE slug = 'decisions/via-path'",
      );
      expect(inStaging.rows[0].n).toBe(1);
      expect(inPublic.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });
});
