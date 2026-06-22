import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/server/mcp.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

async function createStores() {
  const db = await Database.create();
  const pages = new PageStore(db.pg);
  const chunks = new ChunkStore(db.pg);
  return {
    db,
    pages,
    chunks,
    graph: new GraphStore(db.pg),
    tags: new TagStore(db.pg),
    timeline: new TimelineStore(db.pg),
    search: new SearchEngine(db.pg),
    embedding: new EmbeddingService(db.pg, { provider: "openai", apiKey: "test-key" }),
  };
}

async function connect() {
  const stores = await createStores();
  const server = createMcpServer(stores);
  const client = new Client({ name: "memoark-resource-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { stores, server, client };
}

function parseResourceText(result: Awaited<ReturnType<Client["readResource"]>>) {
  const content = result.contents[0];
  if (!content || !("text" in content)) throw new Error("Expected text resource");
  return JSON.parse(content.text);
}

describe("MCP resources", () => {
  let current: Awaited<ReturnType<typeof connect>> | undefined;

  afterEach(async () => {
    await current?.client.close();
    await current?.server.close();
    await current?.stores.db.close();
    current = undefined;
  });

  it("lists static resources and page resource templates", async () => {
    current = await connect();

    const { resources } = await current.client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual([
      "memoark://health",
      "memoark://pages",
    ]);
    expect(resources.every((resource) => resource.description)).toBe(true);

    const { resourceTemplates } = await current.client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "memoark://pages/{slug}",
      "memoark://pages/{slug}/context",
      "memoark://pages/{slug}/timeline",
    ]);
  });

  it("reads health and pages resources with bounded JSON content", async () => {
    current = await connect();
    await current.stores.pages.putPage(
      "projects/memoark",
      "---\ntitle: Memoark\ntype: project\n---\nMemoark memory layer.",
    );

    const health = parseResourceText(
      await current.client.readResource({ uri: "memoark://health" }),
    );
    expect(health).toMatchObject({
      status: "ok",
      mcp_version: expect.any(String),
      legacy_tools_exposed: false,
    });

    const pages = parseResourceText(await current.client.readResource({ uri: "memoark://pages" }));
    expect(pages.pages).toEqual([
      expect.objectContaining({
        slug: "projects/memoark",
        title: "Memoark",
        type: "project",
      }),
    ]);
    expect(pages.limit).toBe(100);
  });

  it("reads page, context, and timeline resources through templates", async () => {
    current = await connect();
    await current.stores.pages.putPage(
      "projects/memoark",
      "---\ntitle: Memoark\ntype: project\n---\nMemoark memory layer.",
    );
    await current.stores.timeline.addEntry("projects/memoark", {
      date: "2026-06-04",
      summary: "Implemented MCP resources",
      detail: "Resources expose page context to MCP clients.",
    });

    const page = parseResourceText(
      await current.client.readResource({ uri: "memoark://pages/projects%2Fmemoark" }),
    );
    expect(page.page.slug).toBe("projects/memoark");
    expect(page.page.compiled_truth).toContain("Memoark memory layer");

    const context = parseResourceText(
      await current.client.readResource({
        uri: "memoark://pages/projects%2Fmemoark/context",
      }),
    );
    expect(context.page.slug).toBe("projects/memoark");
    expect(context.timeline).toHaveLength(1);

    const timeline = parseResourceText(
      await current.client.readResource({
        uri: "memoark://pages/projects%2Fmemoark/timeline",
      }),
    );
    expect(timeline.timeline[0]).toMatchObject({
      summary: "Implemented MCP resources",
    });
    expect(timeline.limit).toBe(100);
  });

  it("returns a readable resource error for missing pages", async () => {
    current = await connect();

    const missing = parseResourceText(
      await current.client.readResource({ uri: "memoark://pages/missing%2Fpage" }),
    );

    expect(missing).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Page not found: missing/page",
        suggestion: "Call `query` or `search` first to find the correct page slug.",
      },
    });
  });
});
