import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/server/mcp.js";
import {
  authorizeMcpHttpRequest,
  createMcpHttpApp,
  isPublicBindHost,
} from "../../src/server/mcp-http.js";
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

describe("MCP Streamable HTTP security", () => {
  it("treats public bind hosts as remote exposure", () => {
    expect(isPublicBindHost("0.0.0.0")).toBe(true);
    expect(isPublicBindHost("::")).toBe(true);
    expect(isPublicBindHost("127.0.0.1")).toBe(false);
    expect(isPublicBindHost("localhost")).toBe(false);
  });

  it("rejects disallowed origins before transport handling", () => {
    const request = new Request("http://127.0.0.1:3927/mcp", {
      headers: { Origin: "https://evil.example", Host: "127.0.0.1:3927" },
    });

    expect(
      authorizeMcpHttpRequest(request, {
        allowedOrigins: ["http://127.0.0.1:3927"],
        allowedHosts: ["127.0.0.1:3927"],
      }),
    ).toEqual({
      ok: false,
      status: 403,
      error: {
        code: "FORBIDDEN_ORIGIN",
        message: "Origin is not allowed for Memoark MCP HTTP",
        suggestion: "Use a configured local origin or add the trusted origin explicitly.",
      },
    });
  });

  it("requires bearer token when configured", () => {
    const request = new Request("http://127.0.0.1:3927/mcp", {
      headers: { Origin: "http://127.0.0.1:3927", Host: "127.0.0.1:3927" },
    });

    expect(
      authorizeMcpHttpRequest(request, {
        allowedOrigins: ["http://127.0.0.1:3927"],
        allowedHosts: ["127.0.0.1:3927"],
        authToken: "secret-token",
      }),
    ).toMatchObject({
      ok: false,
      status: 401,
      error: {
        code: "UNAUTHORIZED",
      },
    });
  });

  it("exposes a guarded HTTP app with a health endpoint", async () => {
    const stores = await createStores();
    const app = createMcpHttpApp(stores, {
      allowedOrigins: ["http://127.0.0.1:3927"],
      allowedHosts: ["127.0.0.1:3927"],
      authToken: "secret-token",
      readOnly: true,
    });

    const health = await app.request("/health");
    expect(await health.json()).toEqual({
      status: "ok",
      transport: "streamable_http",
      auth_required: true,
      read_only: true,
    });

    const denied = await app.request("/mcp", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3927",
        Host: "127.0.0.1:3927",
      },
      body: "{}",
    });
    expect(denied.status).toBe(401);
    await stores.db.close();
  });

  it("read-only MCP mode does not expose write tools", async () => {
    const stores = await createStores();
    const server = createMcpServer(stores, { readOnly: true });
    const client = new Client({ name: "memoark-read-only-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("query");
    expect(names).toContain("search");
    expect(names).toContain("get_health");
    expect(names).not.toContain("put_page");
    expect(names).not.toContain("add_timeline_entry");
    expect(names).not.toContain("manage_links");
    expect(names).not.toContain("manage_tags");

    await client.close();
    await server.close();
    await stores.db.close();
  });
});
