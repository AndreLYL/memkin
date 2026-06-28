import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { parseWikiLinks } from "../../src/store/wikilink.js";

describe("parseWikiLinks (Spec 10 Task 2)", () => {
  it("parses bare [[slug]] as a mentions link", () => {
    expect(parseWikiLinks("see [[entities/alice]] for details")).toEqual([
      { to: "entities/alice", type: "mentions" },
    ]);
  });

  it("parses [[rel:slug]] with a known LinkType", () => {
    expect(parseWikiLinks("[[reports_to:entities/bob]]")).toEqual([
      { to: "entities/bob", type: "reports_to" },
    ]);
  });

  it("maps an unknown rel to custom", () => {
    expect(parseWikiLinks("[[befriends:entities/carol]]")).toEqual([
      { to: "entities/carol", type: "custom" },
    ]);
  });

  it("parses multiple links and trims whitespace inside brackets", () => {
    expect(parseWikiLinks("[[ entities/a ]] and [[ uses : tools/x ]]")).toEqual([
      { to: "entities/a", type: "mentions" },
      { to: "tools/x", type: "uses" },
    ]);
  });

  it("dedupes identical to+type pairs", () => {
    expect(parseWikiLinks("[[entities/a]] [[entities/a]]")).toEqual([
      { to: "entities/a", type: "mentions" },
    ]);
  });

  it("ignores empty or malformed brackets", () => {
    expect(parseWikiLinks("[[]] [[ ]] [[rel:]] plain text")).toEqual([]);
  });
});

describe("putPage wikilink auto-wiring (Spec 10 Task 2)", () => {
  let db: Database;
  let pageStore: PageStore;
  let graph: GraphStore;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.executor);
    graph = new GraphStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates typed edges with provenance.auto=wikilink when targets exist", async () => {
    await pageStore.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pageStore.putPage("entities/bob", "---\ntitle: Bob\ntype: person\n---\nBob.");
    await pageStore.putPage(
      "decisions/d1",
      "---\ntitle: D1\ntype: decision\n---\nDecided with [[entities/alice]] and [[reports_to:entities/bob]].",
    );

    const links = await graph.getLinks("decisions/d1");
    const byTo = new Map(links.map((l) => [l.to_slug, l]));

    expect(byTo.get("entities/alice")?.link_type).toBe("mentions");
    expect(byTo.get("entities/bob")?.link_type).toBe("reports_to");
    expect((byTo.get("entities/alice")?.provenance as { auto?: string })?.auto).toBe("wikilink");
    expect((byTo.get("entities/bob")?.provenance as { auto?: string })?.auto).toBe("wikilink");
  });

  it("skips missing targets without throwing and does not create placeholder pages", async () => {
    await pageStore.putPage(
      "decisions/d2",
      "---\ntitle: D2\ntype: decision\n---\nrefers to [[entities/ghost]] which does not exist.",
    );

    const links = await graph.getLinks("decisions/d2");
    expect(links).toHaveLength(0);
    expect(await pageStore.getPage("entities/ghost")).toBeNull();
  });

  it("only scans compiled_truth, not frontmatter", async () => {
    await pageStore.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pageStore.putPage(
      "decisions/d3",
      "---\ntitle: '[[entities/alice]]'\ntype: decision\n---\nNo links in body.",
    );

    const links = await graph.getLinks("decisions/d3");
    expect(links).toHaveLength(0);
  });

  it("is idempotent on repeated writes (UNIQUE merge)", async () => {
    await pageStore.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    const content = "---\ntitle: D4\ntype: decision\n---\nMentions [[entities/alice]] once.";
    await pageStore.putPage("decisions/d4", content);
    await pageStore.putPage("decisions/d4", content);

    const links = await graph.getLinks("decisions/d4");
    expect(links).toHaveLength(1);
    expect(links[0].to_slug).toBe("entities/alice");
  });
});
