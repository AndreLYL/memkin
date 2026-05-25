import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { SearchEngine } from "../../src/store/search.js";

describe("SearchEngine — FTS", () => {
  let db: Database;
  let pageStore: PageStore;
  let chunkStore: ChunkStore;
  let search: SearchEngine;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.pg);
    chunkStore = new ChunkStore(db.pg);
    search = new SearchEngine(db.pg);

    const p1 = await pageStore.putPage(
      "entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice is a software engineer working on distributed systems."
    );
    await chunkStore.rechunk(p1.id, p1.compiled_truth);

    const p2 = await pageStore.putPage(
      "entities/bob",
      "---\ntitle: Bob\ntype: person\n---\nBob is a product manager focused on machine learning products."
    );
    await chunkStore.rechunk(p2.id, p2.compiled_truth);

    const p3 = await pageStore.putPage(
      "decisions/tech-stack",
      "---\ntitle: Tech Stack Decision\ntype: decision\n---\nWe chose PostgreSQL for the database and TypeScript for the backend."
    );
    await chunkStore.rechunk(p3.id, p3.compiled_truth);
  });

  afterEach(async () => {
    await db.close();
  });

  it("search returns matching pages by keyword", async () => {
    const results = await search.search("engineer");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.slug === "entities/alice")).toBe(true);
  });

  it("search returns empty for no match", async () => {
    const results = await search.search("quantum");
    expect(results).toHaveLength(0);
  });

  it("search respects limit", async () => {
    const results = await search.search("is", { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("search ranks page-level title matches higher (weight A)", async () => {
    const results = await search.search("Alice");
    expect(results[0].slug).toBe("entities/alice");
  });

  it("search returns page metadata in results", async () => {
    const results = await search.search("PostgreSQL");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results.find((x) => x.slug === "decisions/tech-stack")!;
    expect(r.title).toBe("Tech Stack Decision");
    expect(r.type).toBe("decision");
    expect(r.snippet).toBeTruthy();
  });

  it("search handles multi-word queries", async () => {
    const results = await search.search("machine learning");
    expect(results.some((r) => r.slug === "entities/bob")).toBe(true);
  });
});
