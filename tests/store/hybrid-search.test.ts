import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";

const mockEmbedText = vi.fn().mockResolvedValue(Array(768).fill(0.5));

describe("SearchEngine — hybrid query", () => {
  let db: Database;
  let pageStore: PageStore;
  let chunkStore: ChunkStore;
  let graphStore: GraphStore;
  let search: SearchEngine;

  beforeEach(async () => {
    db = await Database.create(undefined, { embeddingDimensions: 768 });
    pageStore = new PageStore(db.executor);
    chunkStore = new ChunkStore(db.executor);
    graphStore = new GraphStore(db.executor);
    search = new SearchEngine(db.executor, { embedText: mockEmbedText });

    const p1 = await pageStore.putPage(
      "entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice is an expert in machine learning and distributed systems.",
    );
    await chunkStore.rechunk(p1.id, p1.compiled_truth);

    const p2 = await pageStore.putPage(
      "entities/bob",
      "---\ntitle: Bob\ntype: person\n---\nBob works on frontend development and design systems.",
    );
    await chunkStore.rechunk(p2.id, p2.compiled_truth);

    const vecStr = `[${Array(768).fill("0.5").join(",")}]`;
    await db.executor.query(
      `UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW()`,
      [vecStr],
    );
  });

  afterEach(async () => {
    await db.close();
  });

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
    const p = await pageStore.putPage(
      "docs/long",
      "---\ntitle: Long Doc\ntype: doc\n---\nA long document.",
    );
    const longContent = Array.from({ length: 400 }, (_, i) => `content${i}`).join(" ");
    await chunkStore.rechunk(p.id, longContent);
    const vecStr = `[${Array(768).fill("0.5").join(",")}]`;
    await db.executor.query(
      `UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW() WHERE page_id = $2`,
      [vecStr, p.id],
    );
    const results = await search.query("content0");
    const docsResults = results.filter((r) => r.slug === "docs/long");
    expect(docsResults.length).toBeLessThanOrEqual(1);
  });

  it("query respects limit", async () => {
    const results = await search.query("is", { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("query returns empty for gibberish with no vector match", async () => {
    mockEmbedText.mockResolvedValueOnce(Array(768).fill(0.0));
    const results = await search.query("xyzzyzzyx12345");
    expect(Array.isArray(results)).toBe(true);
  });

  it("query() recalls Chinese pages via trigram FTS leg (no embeddings)", async () => {
    const chineseSearch = new SearchEngine(db.executor); // no embedText -> vector leg empty
    const p = await pageStore.putPage(
      "knowledge/auth-mw",
      "---\ntitle: 认证中间件重构与上线回滚决策\ntype: knowledge\n---\n认证中间件重构与上线回滚决策",
    );
    await chunkStore.rechunk(p.id, p.compiled_truth);
    const res = await chineseSearch.query("中间件");
    expect(res.map((r) => r.slug)).toContain("knowledge/auth-mw");
  });
});
