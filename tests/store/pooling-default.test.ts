import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";

async function insertChunk(
  pg: import("@electric-sql/pglite").PGlite,
  pageId: number,
  index: number,
  text: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
     VALUES ($1, $2, $3, 'compiled_truth', $4)
     ON CONFLICT (page_id, chunk_index) DO UPDATE SET chunk_text = EXCLUDED.chunk_text`,
    [pageId, index, text, text.split(/\s+/).length],
  );
}

/**
 * Spec 10 Task 1: best-chunk-per-page pooling default flipped on (sum -> max).
 *
 * We construct two pages:
 *  - "weak-many": a page split into MANY weak chunks (each matches the term once,
 *    spread out so they rank low individually but, under SUM pooling, accumulate).
 *  - "strong-one": a page that is a SINGLE strong chunk densely matching the term.
 *
 * Under SUM pooling (old default, poolByPage:false) the many-weak page can overtake
 * the single-strong page because its chunk RRF scores accumulate.
 * Under MAX pooling (new default), each page scores as its strongest single chunk,
 * so the single strong chunk wins.
 */
describe("SearchEngine.query — best-chunk pooling default (Spec 10)", () => {
  let db: Database;
  let pageStore: PageStore;
  let search: SearchEngine;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.executor);
    search = new SearchEngine(db.executor);

    // Page A: many weak chunks. Each chunk mentions "needle" once amidst filler.
    // Many chunks => many low-rank FTS hits that SUM together.
    const weakBody = Array.from(
      { length: 8 },
      (_, i) =>
        `Section ${i}: lots of unrelated filler context paragraph number ${i} discussing assorted topics, and a single needle here.`,
    ).join("\n\n");
    const a = await pageStore.putPage(
      "notes/weak-many",
      `---\ntitle: Weak Many\ntype: note\n---\n${weakBody}`,
    );
    // Force many chunks by inserting each line separately.
    for (let i = 0; i < 8; i++) {
      await insertChunk(
        db.executor,
        a.id,
        i,
        `Section ${i}: filler context number ${i} with a single needle here.`,
      );
    }

    // Page B: one strong chunk densely matching "needle".
    const b = await pageStore.putPage(
      "notes/strong-one",
      "---\ntitle: Strong One\ntype: note\n---\nneedle needle needle needle needle needle needle.",
    );
    await insertChunk(db.executor, b.id, 0, "needle needle needle needle needle needle needle.");
  });

  afterEach(async () => {
    await db.close();
  });

  it("defaults to max pooling: single strong chunk page outranks many-weak-chunk page", async () => {
    const results = await search.query("needle");
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("notes/strong-one");
    expect(slugs).toContain("notes/weak-many");
    // Under MAX pooling the dense single chunk wins.
    expect(slugs.indexOf("notes/strong-one")).toBeLessThan(slugs.indexOf("notes/weak-many"));
  });

  it("explicit poolByPage:false restores sum accumulation (many weak chunks add up)", async () => {
    const results = await search.query("needle", { poolByPage: false });
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("notes/strong-one");
    expect(slugs).toContain("notes/weak-many");
    // Under SUM pooling the 8 accumulating weak chunks overtake the single strong chunk.
    expect(slugs.indexOf("notes/weak-many")).toBeLessThan(slugs.indexOf("notes/strong-one"));
  });
});
