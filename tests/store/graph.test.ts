import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceRef } from "../../src/core/types.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";

describe("GraphStore", () => {
  let db: Database;
  let pages: PageStore;
  let graph: GraphStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.executor);
    graph = new GraphStore(db.executor);
    await pages.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pages.putPage("entities/bob", "---\ntitle: Bob\ntype: person\n---\nBob.");
    await pages.putPage("projects/memkin", "---\ntitle: Memkin\ntype: project\n---\nMemkin.");
  });
  afterEach(async () => {
    await db.close();
  });

  function sourceRef(raw_hash: string, platform = "test"): SourceRef {
    return {
      platform,
      channel: `channel/${raw_hash}`,
      timestamp: "2026-06-04T10:00:00.000Z",
      raw_hash,
      quote: `quote ${raw_hash}`,
    };
  }

  it("addLink creates a link between two pages", async () => {
    await graph.addLink("entities/alice", "projects/memkin", "works_on", "Lead engineer");
    const links = await graph.getLinks("entities/alice");
    expect(links).toHaveLength(1);
    expect(links[0].to_slug).toBe("projects/memkin");
    expect(links[0].link_type).toBe("works_on");
    expect(links[0].context).toBe("Lead engineer");
  });

  it("addLink upserts context on conflict", async () => {
    await graph.addLink("entities/alice", "projects/memkin", "works_on", "V1");
    await graph.addLink("entities/alice", "projects/memkin", "works_on", "V2 updated");
    const links = await graph.getLinks("entities/alice");
    expect(links).toHaveLength(1);
    expect(links[0].context).toBe("V2 updated");
  });

  it("addLink upserts provenance and source hash on conflict", async () => {
    await graph.addLink(
      "entities/alice",
      "projects/memkin",
      "works_on",
      "V1",
      sourceRef("first-hash"),
      "first-hash",
    );
    await graph.addLink(
      "entities/alice",
      "projects/memkin",
      "works_on",
      "V2",
      sourceRef("latest-hash", "feishu"),
      "latest-hash",
    );

    const links = await graph.getLinks("entities/alice");
    expect(links).toHaveLength(1);
    expect(links[0].provenance).toMatchObject({
      platform: "feishu",
      raw_hash: "latest-hash",
    });

    const stored = await db.executor.query<{ source_hash: string }>(
      "SELECT source_hash FROM links WHERE link_type = $1",
      ["works_on"],
    );
    expect(stored.rows[0].source_hash).toBe("latest-hash");
  });

  it("addLink rejects missing page slugs instead of silently inserting zero rows", async () => {
    await expect(graph.addLink("entities/alice", "missing/page", "mentions")).rejects.toThrow(
      "Page not found: missing/page",
    );
  });

  it("getBacklinks returns incoming links", async () => {
    await graph.addLink("entities/alice", "projects/memkin", "works_on");
    await graph.addLink("entities/bob", "projects/memkin", "works_on");
    const backlinks = await graph.getBacklinks("projects/memkin");
    expect(backlinks).toHaveLength(2);
    const slugs = backlinks.map((l) => l.from_slug);
    expect(slugs).toContain("entities/alice");
    expect(slugs).toContain("entities/bob");
  });

  it("removeLink deletes a link", async () => {
    await graph.addLink("entities/alice", "entities/bob", "collaborates");
    await graph.removeLink("entities/alice", "entities/bob");
    const links = await graph.getLinks("entities/alice");
    expect(links).toHaveLength(0);
  });

  it("traverse BFS returns connected nodes", async () => {
    await graph.addLink("entities/alice", "projects/memkin", "works_on");
    await graph.addLink("entities/bob", "projects/memkin", "works_on");
    const result = await graph.traverse("entities/alice", { depth: 2, direction: "out" });
    expect(result.focus.slug).toBe("entities/alice");
    expect(result.focus.title).toBe("Alice");
    const slugs = result.nodes.map((n) => n.slug);
    expect(slugs).toContain("projects/memkin");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      from_slug: "entities/alice",
      to_slug: "projects/memkin",
      link_type: "works_on",
    });
  });

  it("traverse respects depth limit", async () => {
    await graph.addLink("entities/alice", "entities/bob", "collaborates");
    await graph.addLink("entities/bob", "projects/memkin", "works_on");
    const result = await graph.traverse("entities/alice", { depth: 1, direction: "out" });
    const slugs = result.nodes.map((n) => n.slug);
    expect(slugs).toContain("entities/bob");
    expect(slugs).not.toContain("projects/memkin");
    expect(result.edges).toHaveLength(1);
  });

  it("traverse both directions", async () => {
    await graph.addLink("entities/alice", "projects/memkin", "works_on");
    await graph.addLink("entities/bob", "entities/alice", "reports_to");
    const result = await graph.traverse("entities/alice", { depth: 1, direction: "both" });
    const slugs = result.nodes.map((n) => n.slug);
    expect(slugs).toContain("projects/memkin");
    expect(slugs).toContain("entities/bob");
    expect(result.edges).toHaveLength(2);
  });

  it("links cascade on page delete", async () => {
    await graph.addLink("entities/alice", "entities/bob", "collaborates");
    await pages.deletePage("entities/alice");
    const links = await graph.getLinks("entities/bob");
    const backlinks = await graph.getBacklinks("entities/bob");
    expect(links).toHaveLength(0);
    expect(backlinks).toHaveLength(0);
  });

  it("getAllLinksGrouped returns Map<from_slug, links[]> for batch export", async () => {
    await graph.addLink("entities/alice", "projects/memkin", "works_on", "Lead");
    await graph.addLink("entities/alice", "entities/bob", "collaborates", "Pair");
    await graph.addLink("entities/bob", "projects/memkin", "mentions", "");

    const grouped = await graph.getAllLinksGrouped();

    expect(grouped.get("entities/alice")).toHaveLength(2);
    expect(grouped.get("entities/bob")).toHaveLength(1);
    expect(
      grouped.get("entities/alice")?.find((l) => l.to_slug === "entities/bob")?.link_type,
    ).toBe("collaborates");
    expect(grouped.has("projects/memkin")).toBe(false);
  });

  it("getAllLinksGrouped returns empty Map when no links", async () => {
    const grouped = await graph.getAllLinksGrouped();
    expect(grouped.size).toBe(0);
  });
});

describe("GraphStore.getLinksForSlugs", () => {
  let db: Database;
  let graph: GraphStore;
  let pages: PageStore;

  beforeEach(async () => {
    db = await Database.create();
    graph = new GraphStore(db.executor);
    pages = new PageStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns links grouped by from_slug", async () => {
    await pages.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pages.putPage("preferences/morning", "---\ntitle: Morning\ntype: preference\n---\nPref.");
    await pages.putPage("preferences/coding", "---\ntitle: Coding\ntype: preference\n---\nPref2.");
    await graph.addLink("preferences/morning", "entities/alice", "mentions");
    await graph.addLink("preferences/coding", "entities/alice", "mentions");

    const map = await graph.getLinksForSlugs(["preferences/morning", "preferences/coding"]);

    expect(map.get("preferences/morning")).toHaveLength(1);
    expect(map.get("preferences/morning")?.[0].to_slug).toBe("entities/alice");
    expect(map.get("preferences/coding")).toHaveLength(1);
  });

  it("returns empty map for empty input", async () => {
    const map = await graph.getLinksForSlugs([]);
    expect(map.size).toBe(0);
  });

  it("handles slugs with no outgoing links (returns absent key, not empty array)", async () => {
    await pages.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pages.putPage("preferences/a", "---\ntitle: A\ntype: preference\n---\nA.");
    await pages.putPage("preferences/no-link", "---\ntitle: No link\ntype: preference\n---\nB.");
    await graph.addLink("preferences/a", "entities/alice", "mentions");

    const map = await graph.getLinksForSlugs(["preferences/a", "preferences/no-link"]);

    expect(map.get("preferences/a")).toHaveLength(1);
    expect(map.has("preferences/no-link")).toBe(false); // absent, not empty array
  });
});
