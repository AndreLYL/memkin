import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const { version: packageVersion } = require("../../package.json") as { version: string };

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

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (!("content" in result) || result.content[0]?.type !== "text") {
    throw new Error("Expected a text tool result");
  }
  return JSON.parse(result.content[0].text);
}

describe("MCP contract", () => {
  let stores: Awaited<ReturnType<typeof createStores>> | undefined;
  let server: ReturnType<typeof createMcpServer> | undefined;
  let client: Client | undefined;

  async function connect(opts?: { exposeLegacyTools?: boolean }) {
    stores = await createStores();
    server = createMcpServer(stores, opts);
    client = new Client({ name: "memkin-contract-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }

  afterEach(async () => {
    await client?.close();
    await server?.close();
    await stores?.db.close();
    client = undefined;
    server = undefined;
    stores = undefined;
  });

  it("reports the package version through MCP initialization", async () => {
    await connect();
    expect(client.getServerVersion()).toEqual({ name: "memkin", version: packageVersion });
  });

  it("defaults to preferred memory tools and hides legacy CRUD tools", async () => {
    await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      "query",
      "search",
      "get_page_context",
      "timeline_feed",
      "explore_graph",
      "synthesize",
      "recall",
      "prep_for_person",
      "daily_report",
      "troubleshoot",
      "put_page",
      "add_timeline_entry",
      "manage_links",
      "manage_tags",
      "get_health",
      "get_session_context",
      "list_signals_by_entity",
      "get_entity_profile",
      "link_person_alias",
      "list_person_handles",
      "remove_person_alias",
      "merge_persons",
      "recanonicalize_person",
    ]);
    expect(names).not.toContain("query_wechat");
    expect(names).not.toContain("search_feishu");
    expect(names).not.toContain("get_wechat_chat");
    expect(names).not.toContain("get_page");
    expect(names).not.toContain("get_chunks");
    expect(names).not.toContain("traverse_graph");
  });

  it("exposes legacy tools only when enabled", async () => {
    await connect({ exposeLegacyTools: true });
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("get_page");
    expect(names).toContain("list_pages");
    expect(names).toContain("get_chunks");
    expect(names).toContain("traverse_graph");
    expect(tools.find((tool) => tool.name === "get_page")?.description).toMatch(/legacy/i);
  });

  it("describes every registered tool and every input parameter", async () => {
    await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.title, `${tool.name} title`).toBeTruthy();
      expect(tool.description, `${tool.name} description`).toBeTruthy();

      const properties = tool.inputSchema.properties ?? {};
      for (const [name, schema] of Object.entries(properties)) {
        expect(
          (schema as { description?: string }).description,
          `${tool.name}.${name}`,
        ).toBeTruthy();
      }
    }
  });

  it("declares output schemas for core tools and returns structured content", async () => {
    await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "query",
      "search",
      "get_page_context",
      "timeline_feed",
      "explore_graph",
      "put_page",
      "add_timeline_entry",
      "manage_links",
      "manage_tags",
      "get_health",
    ]) {
      expect(byName.get(name)?.outputSchema, `${name} outputSchema`).toBeTruthy();
    }

    const result = await client.callTool({ name: "get_health", arguments: {} });
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      pages: 0,
      chunks: 0,
      mcp_version: packageVersion,
      legacy_tools_exposed: false,
    });
    expect(parseTextResult(result)).toEqual(result.structuredContent);
  });

  it("returns structured recoverable errors from tool calls", async () => {
    await connect();

    const result = await client.callTool({
      name: "get_page_context",
      arguments: { slug: "missing/page" },
    });

    expect("isError" in result ? result.isError : false).toBe(true);
    expect(parseTextResult(result)).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Page not found: missing/page",
        suggestion: "Call `query` or `search` first to find the correct page slug.",
      },
    });
  });

  it("keeps MCP tooling free of source-specific retrieval names", async () => {
    const source = readFileSync(new URL("../../src/server/mcp.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(
      /\b(query_wechat|search_feishu|get_feishu_message|get_wechat_chat)\b/,
    );
  });
});
