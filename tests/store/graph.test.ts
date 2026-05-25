import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { GraphStore } from "../../src/store/graph.js";

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
  afterEach(async () => { await db.close(); });

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
    const nodes = await graph.traverse("entities/alice", { depth: 2, direction: "out" });
    const slugs = nodes.map((n) => n.slug);
    expect(slugs).toContain("projects/memoark");
  });

  it("traverse respects depth limit", async () => {
    await graph.addLink("entities/alice", "entities/bob", "collaborates");
    await graph.addLink("entities/bob", "projects/memoark", "works_on");
    const nodes = await graph.traverse("entities/alice", { depth: 1, direction: "out" });
    const slugs = nodes.map((n) => n.slug);
    expect(slugs).toContain("entities/bob");
    expect(slugs).not.toContain("projects/memoark");
  });

  it("traverse both directions", async () => {
    await graph.addLink("entities/alice", "projects/memoark", "works_on");
    await graph.addLink("entities/bob", "entities/alice", "reports_to");
    const nodes = await graph.traverse("entities/alice", { depth: 1, direction: "both" });
    const slugs = nodes.map((n) => n.slug);
    expect(slugs).toContain("projects/memoark");
    expect(slugs).toContain("entities/bob");
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
