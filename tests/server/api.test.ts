import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "../../src/server/api.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

vi.mock("openai", () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn().mockImplementation(async (params: any) => {
        const inputs = Array.isArray(params.input) ? params.input : [params.input];
        return {
          data: inputs.map((_: string, i: number) => ({
            embedding: Array(params.dimensions ?? 768).fill(0.01 * (i + 1)),
            index: i,
          })),
        };
      }),
    };
  },
}));

describe("REST API", () => {
  let db: Database;
  let app: ReturnType<typeof createApiApp>;

  beforeEach(async () => {
    db = await Database.create();
    const pages = new PageStore(db.executor);
    const chunks = new ChunkStore(db.executor);
    const graph = new GraphStore(db.executor);
    const tags = new TagStore(db.executor);
    const timeline = new TimelineStore(db.executor);
    const search = new SearchEngine(db.executor, {
      embedText: vi.fn().mockResolvedValue(Array(768).fill(0.1)),
    });
    const embedding = new EmbeddingService(db.executor, {
      provider: "openai",
      model: "text-embedding-3-large",
      dimensions: 768,
      apiKey: "test-key",
    });
    app = createApiApp({ db, pages, chunks, graph, tags, timeline, search, embedding });
  });
  afterEach(async () => {
    await db.close();
  });

  it("health returns counts", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.pages).toBe(0);
    expect(body.chunks).toBe(0);
  });

  it("creates and reads pages by slug query param", async () => {
    const put = await app.request("/api/pages/by-slug?slug=projects/memkin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Memkin\ntype: project\n---\nLocal memory." }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/pages/by-slug?slug=projects/memkin");
    expect(get.status).toBe(200);
    const page = await get.json();
    expect(page.slug).toBe("projects/memkin");
  });

  it("returns 400 when slug is missing", async () => {
    const res = await app.request("/api/pages/by-slug");
    expect(res.status).toBe(400);
  });

  it("search endpoint delegates FTS search", async () => {
    await app.request("/api/pages/by-slug?slug=entities/alice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "---\ntitle: Alice\ntype: person\n---\nAlice builds memory systems.",
      }),
    });
    const res = await app.request("/api/search?q=Alice");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((r: { slug: string }) => r.slug === "entities/alice")).toBe(true);
  });

  it("does not require auth when no token is configured (loopback UX)", async () => {
    // `app` in beforeEach is built without an auth token.
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });

  it("supports graph, tags, timeline, chunks, and embed routes", async () => {
    await app.request("/api/pages/by-slug?slug=entities/alice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Alice\ntype: person\n---\nAlice." }),
    });
    await app.request("/api/pages/by-slug?slug=projects/memkin", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Memkin\ntype: project\n---\nMemkin." }),
    });

    expect(
      (
        await app.request("/api/tags?slug=entities/alice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag: "person" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/timeline?slug=entities/alice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date: "2026-05-26", summary: "Started Memkin" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            from: "entities/alice",
            to: "projects/memkin",
            type: "works_on",
          }),
        })
      ).status,
    ).toBe(200);

    expect((await app.request("/api/tags?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/timeline?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/links?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/backlinks?slug=projects/memkin")).status).toBe(200);
    expect(
      (await app.request("/api/graph/traverse?slug=entities/alice&depth=1&direction=out")).status,
    ).toBe(200);
    expect((await app.request("/api/chunks?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/embed", { method: "POST" })).status).toBe(200);
  });
});

describe("REST API auth middleware", () => {
  let db: Database;
  let app: ReturnType<typeof createApiApp>;

  beforeEach(async () => {
    db = await Database.create();
    const pages = new PageStore(db.executor);
    const chunks = new ChunkStore(db.executor);
    const graph = new GraphStore(db.executor);
    const tags = new TagStore(db.executor);
    const timeline = new TimelineStore(db.executor);
    const search = new SearchEngine(db.executor, {
      embedText: vi.fn().mockResolvedValue(Array(768).fill(0.1)),
    });
    const embedding = new EmbeddingService(db.executor, {
      provider: "openai",
      model: "text-embedding-3-large",
      dimensions: 768,
      apiKey: "test-key",
    });
    app = createApiApp(
      { db, pages, chunks, graph, tags, timeline, search, embedding },
      { authToken: "secret-token" },
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it("401s /api/* with no Authorization header", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(401);
  });

  it("401s /api/* with a wrong bearer token", async () => {
    const res = await app.request("/api/health", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("200s /api/* with the correct bearer token", async () => {
    const res = await app.request("/api/health", {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
  });

  it("guards write routes too (PUT /api/pages)", async () => {
    const res = await app.request("/api/pages/by-slug?slug=projects/x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: X\ntype: project\n---\nX." }),
    });
    expect(res.status).toBe(401);
  });
});
