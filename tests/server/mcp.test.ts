import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer, createMcpToolHandlers } from "../../src/server/mcp.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

describe("MCP server", () => {
  let db: Database;
  let stores: Parameters<typeof createMcpToolHandlers>[0];

  beforeEach(async () => {
    db = await Database.create();
    stores = {
      db,
      pages: new PageStore(db.pg),
      chunks: new ChunkStore(db.pg),
      graph: new GraphStore(db.pg),
      tags: new TagStore(db.pg),
      timeline: new TimelineStore(db.pg),
      search: new SearchEngine(db.pg, {
        embedText: vi.fn().mockResolvedValue(Array(768).fill(0.1)),
      }),
      embedding: new EmbeddingService(db.pg, { provider: "openai", apiKey: "test-key" }),
    };
  });
  afterEach(async () => {
    await db.close();
  });

  it("creates an MCP server", () => {
    const server = createMcpServer(stores);
    expect(server).toBeTruthy();
  });

  it("tool handlers can put and get pages", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "entities/alice",
      content: "---\ntitle: Alice\ntype: person\n---\nAlice.",
    });
    const page = await tools.get_page({ slug: "entities/alice" });
    expect(page.slug).toBe("entities/alice");
  });

  it("tool handlers expose query, graph, tags, timeline, chunks, and health", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "entities/alice",
      content: "---\ntitle: Alice\ntype: person\n---\nAlice.",
    });
    await tools.put_page({
      slug: "projects/memoark",
      content: "---\ntitle: Memoark\ntype: project\n---\nMemoark.",
    });
    await tools.add_link({ from: "entities/alice", to: "projects/memoark", type: "works_on" });
    await tools.add_tag({ slug: "entities/alice", tag: "person" });
    await tools.add_timeline_entry({
      slug: "entities/alice",
      date: "2026-05-26",
      summary: "Started Memoark",
    });

    expect(await tools.search({ query: "Alice" })).toHaveLength(1);
    expect(await tools.get_links({ slug: "entities/alice" })).toHaveLength(1);
    expect(await tools.get_backlinks({ slug: "projects/memoark" })).toHaveLength(1);
    expect(
      await tools.traverse_graph({ slug: "entities/alice", depth: 1, direction: "out" }),
    ).toHaveLength(1);
    expect(await tools.get_tags({ slug: "entities/alice" })).toEqual(["person"]);
    expect(await tools.get_timeline({ slug: "entities/alice" })).toHaveLength(1);
    expect(await tools.get_chunks({ slug: "entities/alice" })).toHaveLength(1);
    expect((await tools.get_health()).status).toBe("ok");
  });
});
