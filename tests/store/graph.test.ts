import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";

describe("GraphStore", () => {
  let db: Database;
  let pages: PageStore;
  let graph: GraphStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    graph = new GraphStore(db.pg);
    await pages.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pages.putPage("entities/bob", "---\ntitle: Bob\ntype: person\n---\nBob.");
    await pages.putPage("projects/memoark", "---\ntitle: Memoark\ntype: project\n---\nMemoark.");
  });
  afterEach(async () => {
    await db.close();
  });

  it("addLink creates a link between two pages", async () => {
    await graph.addLink("entities/alice", "projects/memoark", "works_on", "Lead engineer");
    const links = await graph.getLinks("entities/alice");
    expect(links).toHaveLength(1);
    expect(links[0].to_slug).toBe("projects/memoark");
    expect(links[0].link_type).toBe("works_on");
    expect(links[0].context).toBe("Lead engineer");
  });

  it("addLink upserts context on conflict", async () => {
    await graph.addLink("entities/alice", "projects/memoark", "works_on", "V1");
    await graph.addLink("entities/alice", "projects/memoark", "works_on", "V2 updated");
    const links = await graph.getLinks("entities/alice");
    expect(links).toHaveLength(1);
    expect(links[0].context).toBe("V2 updated");
  });

  it("getBacklinks returns incoming links", async () => {
    await graph.addLink("entities/alice", "projects/memoark", "works_on");
    await graph.addLink("entities/bob", "projects/memoark", "works_on");
    const backlinks = await graph.getBacklinks("projects/memoark");
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
    await graph.addLink("entities/alice", "projects/memoark", "works_on");
    await graph.addLink("entities/bob", "projects/memoark", "works_on");
    const result = await graph.traverse("entities/alice", { depth: 2, direction: "out" });
    expect(result.focus.slug).toBe("entities/alice");
    expect(result.focus.title).toBe("Alice");
    const slugs = result.nodes.map((n) => n.slug);
    expect(slugs).toContain("projects/memoark");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      from_slug: "entities/alice",
      to_slug: "projects/memoark",
      link_type: "works_on",
    });
  });

  it("traverse respects depth limit", async () => {
    await graph.addLink("entities/alice", "entities/bob", "collaborates");
    await graph.addLink("entities/bob", "projects/memoark", "works_on");
    const result = await graph.traverse("entities/alice", { depth: 1, direction: "out" });
    const slugs = result.nodes.map((n) => n.slug);
    expect(slugs).toContain("entities/bob");
    expect(slugs).not.toContain("projects/memoark");
    expect(result.edges).toHaveLength(1);
  });

  it("traverse both directions", async () => {
    await graph.addLink("entities/alice", "projects/memoark", "works_on");
    await graph.addLink("entities/bob", "entities/alice", "reports_to");
    const result = await graph.traverse("entities/alice", { depth: 1, direction: "both" });
    const slugs = result.nodes.map((n) => n.slug);
    expect(slugs).toContain("projects/memoark");
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
});
