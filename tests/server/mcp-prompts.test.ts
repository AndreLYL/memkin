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
  return {
    db,
    pages: new PageStore(db.pg),
    chunks: new ChunkStore(db.pg),
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
  const client = new Client({ name: "memoark-prompt-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { stores, server, client };
}

function promptText(result: Awaited<ReturnType<Client["getPrompt"]>>) {
  const content = result.messages[0]?.content;
  if (!content || content.type !== "text") throw new Error("Expected text prompt");
  return content.text;
}

describe("MCP prompts", () => {
  let current: Awaited<ReturnType<typeof connect>> | undefined;

  afterEach(async () => {
    await current?.client.close();
    await current?.server.close();
    await current?.stores.db.close();
    current = undefined;
  });

  it("lists memory workflow prompts with descriptions and arguments", async () => {
    current = await connect();

    const { prompts } = await current.client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "recall",
      "weekly-digest",
      "who-is",
      "decision-log",
      "handoff",
    ]);
    for (const prompt of prompts) {
      expect(prompt.description, prompt.name).toBeTruthy();
      expect(prompt.arguments?.length, prompt.name).toBeGreaterThan(0);
    }
  });

  it("returns prompts that reference the preferred MCP tools", async () => {
    current = await connect();

    const recall = promptText(
      await current.client.getPrompt({
        name: "recall",
        arguments: { topic: "Memoark deployment", platform: "wechat", participant: "张三" },
      }),
    );
    expect(recall).toContain("query");
    expect(recall).toContain("platform");
    expect(recall).toContain("participant");

    const handoff = promptText(
      await current.client.getPrompt({
        name: "handoff",
        arguments: { project: "memoark" },
      }),
    );
    expect(handoff).toContain("get_page_context");
    expect(handoff).toContain("timeline_feed");
    expect(handoff).toContain("explore_graph");
  });

  it("validates prompt arguments", async () => {
    current = await connect();

    await expect(current.client.getPrompt({ name: "recall", arguments: {} })).rejects.toThrow();
  });

  it("does not hard-code source-specific retrieval tools", async () => {
    current = await connect();

    const { prompts } = await current.client.listPrompts();
    for (const prompt of prompts) {
      const result = await current.client.getPrompt({
        name: prompt.name,
        arguments:
          prompt.name === "who-is"
            ? { person: "Alice" }
            : prompt.name === "weekly-digest"
              ? { days: "7" }
              : prompt.name === "decision-log"
                ? { topic: "Memoark" }
                : prompt.name === "handoff"
                  ? { project: "Memoark" }
                  : { topic: "Memoark" },
      });
      expect(promptText(result)).not.toMatch(
        /\b(query_wechat|search_feishu|get_feishu_message|get_wechat_chat)\b/,
      );
    }
  });
});
