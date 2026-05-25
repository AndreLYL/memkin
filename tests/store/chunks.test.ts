import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { ChunkStore } from "../../src/store/chunks.js";

describe("ChunkStore", () => {
  let db: Database;
  let pages: PageStore;
  let chunks: ChunkStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    chunks = new ChunkStore(db.pg);
  });

  afterEach(async () => {
    await db.close();
  });

  it("rechunk splits content into chunks with overlap", async () => {
    const page = await pages.putPage("test/chunked", "---\ntitle: T\ntype: test\n---\nBody.");
    const longContent = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    await chunks.rechunk(page.id, longContent);
    const result = await chunks.getChunks("test/chunked");
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].chunk_index).toBe(0);
    expect(result[0].chunk_source).toBe("compiled_truth");
    for (const c of result) {
      expect(c.chunk_text.split(/\s+/).length).toBeLessThanOrEqual(350);
    }
  });

  it("rechunk short content produces a single chunk", async () => {
    const page = await pages.putPage("test/short", "---\ntitle: S\ntype: test\n---\nShort body.");
    await chunks.rechunk(page.id, "Short body.");
    const result = await chunks.getChunks("test/short");
    expect(result).toHaveLength(1);
    expect(result[0].chunk_text).toBe("Short body.");
  });

  it("rechunk preserves embedding when chunk_text unchanged", async () => {
    const page = await pages.putPage("test/stable", "---\ntitle: S\ntype: test\n---\nStable.");
    await chunks.rechunk(page.id, "Stable content.");
    await db.pg.query(
      `UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW()
       WHERE page_id = $2`,
      ["[" + Array(1536).fill("0.1").join(",") + "]", page.id]
    );
    await chunks.rechunk(page.id, "Stable content.");
    const result = await chunks.getChunks("test/stable");
    expect(result[0].embedded_at).not.toBeNull();
  });

  it("rechunk clears embedding when chunk_text changes", async () => {
    const page = await pages.putPage("test/changed", "---\ntitle: C\ntype: test\n---\nOld.");
    await chunks.rechunk(page.id, "Old content.");
    await db.pg.query(
      `UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW()
       WHERE page_id = $2`,
      ["[" + Array(1536).fill("0.1").join(",") + "]", page.id]
    );
    await chunks.rechunk(page.id, "New different content.");
    const result = await chunks.getChunks("test/changed");
    expect(result[0].embedded_at).toBeNull();
  });

  it("rechunk deletes stale chunks when count shrinks", async () => {
    const page = await pages.putPage("test/shrink", "---\ntitle: K\ntype: test\n---\nBody.");
    const longContent = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    await chunks.rechunk(page.id, longContent);
    const before = await chunks.getChunks("test/shrink");
    expect(before.length).toBeGreaterThan(1);
    await chunks.rechunk(page.id, "Short now.");
    const after = await chunks.getChunks("test/shrink");
    expect(after).toHaveLength(1);
  });

  it("getStaleChunks returns chunks with no embedding", async () => {
    const page = await pages.putPage("test/stale", "---\ntitle: S\ntype: test\n---\nBody.");
    await chunks.rechunk(page.id, "Needs embedding.");
    const stale = await chunks.getStaleChunks();
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale.every((c) => c.embedded_at === null)).toBe(true);
  });

  it("getStaleChunks respects limit", async () => {
    const page = await pages.putPage("test/many", "---\ntitle: M\ntype: test\n---\nBody.");
    const longContent = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    await chunks.rechunk(page.id, longContent);
    const stale = await chunks.getStaleChunks(1);
    expect(stale).toHaveLength(1);
  });

  it("chunk search_vector is auto-populated by trigger", async () => {
    const page = await pages.putPage("test/fts", "---\ntitle: F\ntype: test\n---\nBody.");
    await chunks.rechunk(page.id, "Hello world full text search.");
    const result = await db.pg.query(
      "SELECT search_vector IS NOT NULL AS has_sv FROM content_chunks WHERE page_id = $1",
      [page.id]
    );
    expect(result.rows[0].has_sv).toBe(true);
  });
});
