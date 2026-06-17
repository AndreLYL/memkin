import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSchemaSql } from "../../src/store/database.js";
import { buildPGliteOptions } from "../../src/store/pglite-assets.js";

// Risk-2 verification: exercise the explicit-blobs PGLite path (compiled-binary mode)
// against the *real* Memoark schema, pointing assets at node_modules/.../dist so we can
// validate the custom vector extension + HNSW index without an actual `bun --compile`.
describe("explicit-blobs PGLite runs full Memoark schema", () => {
  it("creates HNSW index and a usable vector column via custom vector extension", async () => {
    const dist = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
    const pg = new PGlite(await buildPGliteOptions(undefined, { compiled: true, assetsOverride: dist }));

    await pg.exec(loadSchemaSql(3)); // tiny dim so we can hand-write a vector literal

    const idx = await pg.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_chunks_embedding'",
    );
    expect(idx.rows.length).toBe(1);

    // End-to-end: insert a page + chunk with an embedding, then cosine-search it back.
    await pg.exec(
      "INSERT INTO pages (slug, type, title) VALUES ('t/a', 'note', 'A') ON CONFLICT DO NOTHING;",
    );
    await pg.exec(
      "INSERT INTO content_chunks (page_id, chunk_index, chunk_text, embedding) " +
        "VALUES ((SELECT id FROM pages WHERE slug = 't/a'), 0, 'hello', '[1,0,0]');",
    );
    const hit = await pg.query<{ chunk_text: string }>(
      "SELECT chunk_text FROM content_chunks ORDER BY embedding <=> '[1,0,0]' LIMIT 1;",
    );
    expect(hit.rows[0]?.chunk_text).toBe("hello");

    await pg.close();
  });
});
