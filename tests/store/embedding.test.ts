import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { PageStore } from "../../src/store/pages.js";

vi.mock("openai", () => {
  interface EmbeddingCreateParams {
    input: string | string[];
    dimensions?: number;
  }

  return {
    default: class MockOpenAI {
      embeddings = {
        create: vi.fn().mockImplementation(async (params: EmbeddingCreateParams) => {
          const inputs = Array.isArray(params.input) ? params.input : [params.input];
          return {
            data: inputs.map((_: string, i: number) => ({
              embedding: Array(params.dimensions ?? 1536).fill(0.01 * (i + 1)),
              index: i,
            })),
          };
        }),
      };
    },
  };
});

describe("EmbeddingService", () => {
  let db: Database;
  let pageStore: PageStore;
  let chunkStore: ChunkStore;
  let embedder: EmbeddingService;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.pg);
    chunkStore = new ChunkStore(db.pg);
    embedder = new EmbeddingService(db.pg, {
      provider: "openai",
      model: "text-embedding-3-large",
      dimensions: 1536,
      apiKey: "test-key",
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("embedStale embeds chunks with no embedding", async () => {
    const page = await pageStore.putPage(
      "test/embed",
      "---\ntitle: E\ntype: test\n---\nSome content to embed.",
    );
    await chunkStore.rechunk(page.id, page.compiled_truth);
    const staleBefore = await chunkStore.getStaleChunks();
    expect(staleBefore.length).toBeGreaterThan(0);
    const result = await embedder.embedStale({ limit: 100 });
    expect(result.embedded).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
    const staleAfter = await chunkStore.getStaleChunks();
    expect(staleAfter).toHaveLength(0);
  });

  it("embedStale respects limit", async () => {
    const page = await pageStore.putPage("test/lim", "---\ntitle: L\ntype: test\n---\nBody.");
    const longContent = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    await chunkStore.rechunk(page.id, longContent);
    const staleCount = (await chunkStore.getStaleChunks()).length;
    expect(staleCount).toBeGreaterThan(1);
    const result = await embedder.embedStale({ limit: 1 });
    expect(result.embedded).toBe(1);
    const remaining = await chunkStore.getStaleChunks();
    expect(remaining).toHaveLength(staleCount - 1);
  });

  it("embedText returns a vector", async () => {
    const vector = await embedder.embedText("hello world");
    expect(vector).toHaveLength(1536);
    expect(typeof vector[0]).toBe("number");
  });

  it("embedStale returns zero when no stale chunks", async () => {
    const result = await embedder.embedStale();
    expect(result.embedded).toBe(0);
    expect(result.errors).toBe(0);
  });
});
