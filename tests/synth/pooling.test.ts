import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";

/**
 * best-chunk-per-page pooling (Spec 7 §七).
 *
 * Construct:
 *   - Page B (one strong chunk): a single chunk that ranks first (rank 0).
 *   - Page A (many weak chunks): several chunks that each match but rank lower.
 *
 * Default (sum): Page A's accumulated RRF beats Page B → A first.
 * poolByPage:true (max): Page B's single strongest chunk wins → B first.
 */
describe("SearchEngine — poolByPage (best-chunk-per-page)", () => {
  let db: Database;
  let pageStore: PageStore;
  let search: SearchEngine;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.pg);
    search = new SearchEngine(db.pg);

    // Page B: one strong chunk (lots of matching terms → highest ts_rank → rank 0).
    const b = await pageStore.putPage(
      "pages/strong-b",
      "---\ntitle: Strong B\ntype: note\n---\nplaceholder",
    );
    await db.pg.query(
      `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
       VALUES ($1, 0, $2, 'compiled_truth', 10)`,
      [b.id, "poolword poolword poolword poolword poolword strong evidence"],
    );

    // Page A: several weak chunks (each matches once → lower ts_rank → ranks 1..N).
    const a = await pageStore.putPage(
      "pages/weak-a",
      "---\ntitle: Weak A\ntype: note\n---\nplaceholder",
    );
    for (let i = 0; i < 3; i++) {
      await db.pg.query(
        `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
         VALUES ($1, $2, $3, 'compiled_truth', 20)`,
        [a.id, i, `poolword appears once in weak chunk number ${i} with filler text ${i}`],
      );
    }

    // Neutralize freshness skew: pin both pages to the same updated_at.
    await db.pg.query(
      `UPDATE pages SET updated_at = '2026-06-01T00:00:00.000Z' WHERE slug = ANY($1::text[])`,
      [["pages/strong-b", "pages/weak-a"]],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it("default (sum) lets a many-weak-chunk page outrank a single-strong-chunk page", async () => {
    const results = await search.query("poolword");
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("pages/weak-a");
    expect(slugs).toContain("pages/strong-b");
    expect(slugs.indexOf("pages/weak-a")).toBeLessThan(slugs.indexOf("pages/strong-b"));
  });

  it("poolByPage:true (max) surfaces the single-strong-chunk page first", async () => {
    const results = await search.query("poolword", { poolByPage: true });
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("pages/weak-a");
    expect(slugs).toContain("pages/strong-b");
    expect(slugs.indexOf("pages/strong-b")).toBeLessThan(slugs.indexOf("pages/weak-a"));
  });

  it("the two modes produce different orderings", async () => {
    const sumOrder = (await search.query("poolword")).map((r) => r.slug);
    const maxOrder = (await search.query("poolword", { poolByPage: true })).map((r) => r.slug);
    expect(sumOrder).not.toEqual(maxOrder);
  });
});
