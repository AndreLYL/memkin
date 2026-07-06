import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer, createMcpToolHandlers } from "../../src/server/mcp.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

interface EvalTask {
  id: string;
  type: string;
  prompt: string;
  expected_tools: string[];
  forbidden_tools: string[];
  expected_filters: Record<string, unknown>;
  success_criteria: string[];
}

interface MemorySeed {
  pages: Array<{ slug: string; content: string }>;
  timeline: Array<{
    slug: string;
    date: string;
    summary: string;
    detail?: string;
    provenance?: Record<string, unknown>;
  }>;
  links: Array<{ from: string; to: string; type?: string; context?: string }>;
  tags: Array<{ slug: string; tag: string }>;
}

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

function readTasks(): EvalTask[] {
  return readFileSync(new URL("../fixtures/mcp-eval/tasks.jsonl", import.meta.url), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as EvalTask);
}

function readSeed(): MemorySeed {
  return JSON.parse(
    readFileSync(new URL("../fixtures/mcp-eval/memory-seed.json", import.meta.url), "utf-8"),
  ) as MemorySeed;
}

async function seedStores(stores: Awaited<ReturnType<typeof createStores>>) {
  const seed = readSeed();
  for (const page of seed.pages) {
    const stored = await stores.pages.putPage(page.slug, page.content);
    await stores.chunks.rechunk(stored.id, stored.compiled_truth);
  }
  for (const entry of seed.timeline) {
    await stores.timeline.addEntry(entry.slug, {
      date: entry.date,
      summary: entry.summary,
      detail: entry.detail,
      provenance: entry.provenance as never,
    });
  }
  for (const link of seed.links) {
    await stores.graph.addLink(link.from, link.to, link.type ?? "mentions", link.context);
  }
  for (const tag of seed.tags) {
    await stores.tags.addTag(tag.slug, tag.tag);
  }
}

async function listToolNames(stores: Awaited<ReturnType<typeof createStores>>, readOnly = false) {
  const server = createMcpServer(stores, { readOnly });
  const client = new Client({ name: "memkin-eval-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools.map((tool) => tool.name);
}

describe("MCP contract eval runner", () => {
  let stores: Awaited<ReturnType<typeof createStores>> | undefined;

  afterEach(async () => {
    await stores?.db.close();
    stores = undefined;
  });

  it("loads a 30 task eval set with expected tools, filters, and criteria", () => {
    const tasks = readTasks();
    expect(tasks).toHaveLength(30);
    for (const task of tasks) {
      expect(task.id).toBeTruthy();
      expect(task.prompt).toBeTruthy();
      expect(task.success_criteria.length).toBeGreaterThan(0);
      expect(Array.isArray(task.expected_tools)).toBe(true);
      expect(Array.isArray(task.forbidden_tools)).toBe(true);
      expect(task.expected_filters).toBeTypeOf("object");
    }
  });

  it("keeps default MCP tools compatible with eval expectations", async () => {
    stores = await createStores();
    const names = await listToolNames(stores);
    const taskTools = new Set(readTasks().flatMap((task) => task.expected_tools));

    for (const tool of taskTools) {
      if (tool) expect(names, tool).toContain(tool);
    }
    expect(names).not.toContain("query_wechat");
    expect(names).not.toContain("search_feishu");
    expect(names).not.toContain("get_feishu_message");
    expect(names).not.toContain("get_wechat_chat");
  });

  it("keeps read-only MCP tools free of write actions", async () => {
    stores = await createStores();
    const names = await listToolNames(stores, true);
    expect(names).not.toContain("put_page");
    expect(names).not.toContain("add_timeline_entry");
    expect(names).not.toContain("manage_links");
    expect(names).not.toContain("manage_tags");
  });

  it("seeds memory and verifies source-filtered timeline behavior", async () => {
    stores = await createStores();
    await seedStores(stores);
    const tools = createMcpToolHandlers(stores);

    const codex = await tools.timeline_feed({ platform: "codex" });
    expect(codex).toEqual([
      expect.objectContaining({
        slug: "projects/memkin",
        provenance: expect.objectContaining({ platform: "codex" }),
      }),
    ]);

    const feishuGroup = await tools.timeline_feed({ platform: "feishu", source_type: "group" });
    expect(feishuGroup).toEqual([
      expect.objectContaining({
        slug: "decisions/use-pglite",
        provenance: expect.objectContaining({ platform: "feishu", source_type: "group" }),
      }),
    ]);
  });
});
