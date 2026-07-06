import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { DIRECTIVE_L2 } from "../../src/install/directive.js";
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
  return {
    db,
    pages: new PageStore(db.executor),
    chunks: new ChunkStore(db.executor),
    graph: new GraphStore(db.executor),
    tags: new TagStore(db.executor),
    timeline: new TimelineStore(db.executor),
    search: new SearchEngine(db.executor),
    embedding: new EmbeddingService(db.executor, { provider: "openai", apiKey: "test-key" }),
  };
}

describe("MCP server instructions (L2 directive)", () => {
  let stores: Awaited<ReturnType<typeof createStores>> | undefined;
  let server: ReturnType<typeof createMcpServer> | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
    await stores?.db.close();
    client = undefined;
    server = undefined;
    stores = undefined;
  });

  it("sends the L2 memory directive as server instructions on initialize", async () => {
    stores = await createStores();
    server = createMcpServer(stores);
    client = new Client({ name: "memkin-instructions-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const instructions = client.getInstructions();
    expect(instructions).toBe(DIRECTIVE_L2);
    // Key behavioural constraints must survive in whatever the client receives.
    expect(instructions).toContain("source of truth");
    expect(instructions).toContain("Brain-first, cheap-first");
    expect(instructions).toContain("get_session_context");
  });
});
