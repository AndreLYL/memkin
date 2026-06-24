import { describe, expect, it, vi } from "vitest";
import { recall } from "../../src/hooks/recall-client.js";

const rows = [
  { slug: "people/xu", score: 0.9, snippet: "上周聊了续约", title: "许力子" },
  { slug: "junk", score: 0.1 },
];

describe("recall client", () => {
  it("uses the running serve REST when reachable, not the store", async () => {
    const store = { search: vi.fn() };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => rows }));
    const hits = await recall("许力子", { fetchImpl, store });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toContain("/api/search?q=");
    expect(store.search).not.toHaveBeenCalled();
    expect(hits[0]).toMatchObject({ slug: "people/xu", score: 0.9 });
  });

  it("falls back to the direct FTS store when serve is down", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const store = { search: vi.fn(async () => rows) };
    const hits = await recall("许力子", { fetchImpl, store });
    expect(store.search).toHaveBeenCalledWith("许力子", { limit: 5 });
    expect(hits.map((h) => h.slug)).toContain("people/xu");
  });

  it("returns [] when neither REST nor store is available", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await recall("x", { fetchImpl })).toEqual([]);
  });
});
