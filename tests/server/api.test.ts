import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { SearchEngine } from "../../src/store/search.js";
import { GraphStore } from "../../src/store/graph.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { createApiApp } from "../../src/server/api.js";

vi.mock("openai", () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn().mockImplementation(async (params: any) => {
        const inputs = Array.isArray(params.input) ? params.input : [params.input];
        return { data: inputs.map((_: string, i: number) => ({ embedding: Array(params.dimensions ?? 1536).fill(0.01 * (i + 1)), index: i })) };
      }),
    };
  },
}));

describe("REST API", () => {
  let db: Database;
  let app: Hono;

  beforeEach(async () => {
    db = await Database.create();
    const pages = new PageStore(db.pg);
    const chunks = new ChunkStore(db.pg);
    const graph = new GraphStore(db.pg);
    const tags = new TagStore(db.pg);
    const timeline = new TimelineStore(db.pg);
    const search = new SearchEngine(db.pg, { embedText: vi.fn().mockResolvedValue(Array(1536).fill(0.1)) });
    const embedding = new EmbeddingService(db.pg, { provider: "openai", model: "text-embedding-3-large", dimensions: 1536, apiKey: "test-key" });
    const apiApp = createApiApp({ db, pages, chunks, graph, tags, timeline, search, embedding });
    const wrapper = new Hono();
    wrapper.route("/api", apiApp);
    app = wrapper;
  });
  afterEach(async () => { await db.close(); });

  it("health returns counts", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.pages).toBe(0);
    expect(body.chunks).toBe(0);
  });

  it("creates and reads pages by slug query param", async () => {
    const put = await app.request("/api/pages/by-slug?slug=projects/memoark", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Memoark\ntype: project\n---\nLocal memory." }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/pages/by-slug?slug=projects/memoark");
    expect(get.status).toBe(200);
    const page = await get.json();
    expect(page.slug).toBe("projects/memoark");
  });

  it("returns 400 when slug is missing", async () => {
    const res = await app.request("/api/pages/by-slug");
    expect(res.status).toBe(400);
  });

  it("search endpoint delegates FTS search", async () => {
    await app.request("/api/pages/by-slug?slug=entities/alice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Alice\ntype: person\n---\nAlice builds memory systems." }),
    });
    const res = await app.request("/api/search?q=Alice");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((r: { slug: string }) => r.slug === "entities/alice")).toBe(true);
  });

  it("supports graph, tags, timeline, chunks, and embed routes", async () => {
    await app.request("/api/pages/by-slug?slug=entities/alice", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Alice\ntype: person\n---\nAlice." }),
    });
    await app.request("/api/pages/by-slug?slug=projects/memoark", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Memoark\ntype: project\n---\nMemoark." }),
    });

    expect((await app.request("/api/tags?slug=entities/alice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tag: "person" }) })).status).toBe(200);
    expect((await app.request("/api/timeline?slug=entities/alice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-05-26", summary: "Started Memoark" }) })).status).toBe(200);
    expect((await app.request("/api/links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "entities/alice", to: "projects/memoark", type: "works_on" }) })).status).toBe(200);

    expect((await app.request("/api/tags?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/timeline?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/links?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/backlinks?slug=projects/memoark")).status).toBe(200);
    expect((await app.request("/api/graph/traverse?slug=entities/alice&depth=1&direction=out")).status).toBe(200);
    expect((await app.request("/api/chunks?slug=entities/alice")).status).toBe(200);
    expect((await app.request("/api/embed", { method: "POST" })).status).toBe(200);
  });

  it("stats returns aggregated counts and pages_by_type", async () => {
    await app.request("/api/pages/by-slug?slug=entities/alice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Alice\ntype: person\n---\nAlice." }),
    });
    await app.request("/api/pages/by-slug?slug=projects/memoark", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Memoark\ntype: project\n---\nMemory." }),
    });

    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pages).toBe(2);
    expect(body.chunks).toBeGreaterThanOrEqual(0);
    expect(body.embedded_chunks).toBeGreaterThanOrEqual(0);
    expect(body.links).toBeGreaterThanOrEqual(0);
    expect(body.pages_by_type).toEqual(expect.objectContaining({ person: 1, project: 1 }));
  });

  it("links/all returns all link relationships", async () => {
    await app.request("/api/pages/by-slug?slug=entities/alice", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Alice\ntype: person\n---\nAlice." }),
    });
    await app.request("/api/pages/by-slug?slug=projects/memoark", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Memoark\ntype: project\n---\nMemory." }),
    });
    await app.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "entities/alice", to: "projects/memoark", type: "works_on", context: "developer" }),
    });

    const res = await app.request("/api/links/all");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      from_slug: "entities/alice",
      to_slug: "projects/memoark",
      link_type: "works_on",
      context: "developer",
    });
  });

  it("GET /api/pages supports sort, order, and limit=0", async () => {
    await app.request("/api/pages/by-slug?slug=b-page", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Bravo\ntype: unknown\n---\nB" }),
    });
    await app.request("/api/pages/by-slug?slug=a-page", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "---\ntitle: Alpha\ntype: unknown\n---\nA" }),
    });

    const res = await app.request("/api/pages?sort=title&order=asc&limit=0");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].title).toBe("Alpha");
    expect(body[1].title).toBe("Bravo");
  });
});
