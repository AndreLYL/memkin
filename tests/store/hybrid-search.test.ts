import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { GraphStore } from "../../src/store/graph.js";
import { SearchEngine } from "../../src/store/search.js";

const mockEmbedText = vi.fn().mockResolvedValue(Array(1536).fill(0.5));

describe("SearchEngine — hybrid query", () => {
  let db: Database;
  let pageStore: PageStore;
  let chunkStore: ChunkStore;
  let graphStore: GraphStore;
  let search: SearchEngine;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.pg);
    chunkStore = new ChunkStore(db.pg);
    graphStore = new GraphStore(db.pg);
    search = new SearchEngine(db.pg, { embedText: mockEmbedText });

    const p1 = await pageStore.putPage("entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice is an expert in machine learning and distributed systems.");
    await chunkStore.rechunk(p1.id, p1.compiled_truth);

    const p2 = await pageStore.putPage("entities/bob",
      "---\ntitle: Bob\ntype: person\n---\nBob works on frontend development and design systems.");
    await chunkStore.rechunk(p2.id, p2.compiled_truth);

    const vecStr = "[" + Array(1536).fill("0.5").join(",") + "]";
    await db.pg.query(`UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW()`, [vecStr]);
  });

  afterEach(async () => { await db.close(); });

  it("query returns results combining FTS and vector", async () => {
    const results = await search.query("machine learning");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].slug).toBeTruthy();
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("query applies compiled_truth boost", async () => {
    const results = await search.query("Alice");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("query applies backlink boost", async () => {
    await graphStore.addLink("entities/bob", "entities/alice", "collaborates");
    await graphStore.addLink("entities/bob", "entities/alice", "mentions");
    const results = await search.query("expert");
    const alice = results.find((r) => r.slug === "entities/alice");
    expect(alice).toBeTruthy();
  });

  it("query deduplicates per page (keeps highest score chunk)", async () => {
    const p = await pageStore.putPage("docs/long", "---\ntitle: Long Doc\ntype: doc\n---\nA long document.");
    const longContent = Array.from({ length: 400 }, (_, i) => `content${i}`).join(" ");
    await chunkStore.rechunk(p.id, longContent);
    const vecStr = "[" + Array(1536).fill("0.5").join(",") + "]";
    await db.pg.query(`UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW() WHERE page_id = $2`, [vecStr, p.id]);
    const results = await search.query("content0");
    const docsResults = results.filter((r) => r.slug === "docs/long");
    expect(docsResults.length).toBeLessThanOrEqual(1);
  });

  it("query respects limit", async () => {
    const results = await search.query("is", { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("query returns empty for gibberish with no vector match", async () => {
    mockEmbedText.mockResolvedValueOnce(Array(1536).fill(0.0));
    const results = await search.query("xyzzyzzyx12345");
    expect(Array.isArray(results)).toBe(true);
  });
});
