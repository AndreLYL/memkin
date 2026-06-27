/**
 * Tests for the person identity Layer 1: typed handle resolution, explicit
 * aliasing, merge, and rename — plus integration with IdentityResolver
 * (strong handles auto-resolve; weak nicknames never auto-merge).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import {
  canonicalizeHandleValue,
  defaultStrength,
  PersonIdentityStore,
} from "../../src/core/person-identity.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

function personPage(slug: string, name: string, body = "body", aliases?: string[]): string {
  const fm = [`title: ${name}`, "type: person"];
  if (aliases) fm.push(`aliases:\n${aliases.map((a) => `  - ${a}`).join("\n")}`);
  return `---\n${fm.join("\n")}\n---\n${body}`;
}

describe("canonicalizeHandleValue", () => {
  it("lowercases emails and open ids, collapses name whitespace, passes slugs", () => {
    expect(canonicalizeHandleValue("email", "  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(canonicalizeHandleValue("feishu_open_id", "OU_Abc123")).toBe("ou_abc123");
    expect(canonicalizeHandleValue("name", "  李  应龙 ")).toBe("李 应龙");
    expect(canonicalizeHandleValue("nickname", " 龙哥 ")).toBe("龙哥");
    expect(canonicalizeHandleValue("slug", "person/li-yinglong")).toBe("person/li-yinglong");
  });

  it("nicknames are weak, everything else strong by default", () => {
    expect(defaultStrength("nickname")).toBe("weak");
    expect(defaultStrength("email")).toBe("strong");
    expect(defaultStrength("name")).toBe("strong");
  });
});

describe("PersonIdentityStore", () => {
  let db: Database;
  let identity: PersonIdentityStore;
  let pages: PageStore;
  let graph: GraphStore;
  let timeline: TimelineStore;
  let tags: TagStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.executor);
    graph = new GraphStore(db.executor);
    timeline = new TimelineStore(db.executor);
    tags = new TagStore(db.executor);
    identity = new PersonIdentityStore(db.executor, { pages });
  });

  afterEach(async () => {
    await db.close();
  });

  describe("aliases", () => {
    it("attaches and resolves a handle", async () => {
      await pages.putPage("person/li-yinglong", personPage("person/li-yinglong", "李应龙"));
      await identity.addAlias("person/li-yinglong", "nickname", "龙哥");

      expect(await identity.resolveHandle("nickname", "龙哥")).toBe("person/li-yinglong");
      // reflected into page frontmatter
      const page = await pages.getPage("person/li-yinglong");
      expect(page?.frontmatter.aliases).toContain("龙哥");
    });

    it("rejects a handle that already maps to a different person", async () => {
      await identity.addAlias("person/x", "email", "a@b.com");
      await expect(identity.addAlias("person/y", "email", "a@b.com")).rejects.toThrow(
        /already maps to/,
      );
    });

    it("lists and removes handles", async () => {
      await identity.addAlias("person/x", "email", "A@B.com");
      await identity.addAlias("person/x", "nickname", "X哥");
      expect(await identity.listHandles("person/x")).toHaveLength(2);

      await identity.removeHandle("email", "a@b.com");
      const remaining = await identity.listHandles("person/x");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].kind).toBe("nickname");
    });
  });

  describe("resolveForExtraction", () => {
    it("resolves via slug, embedded open id, email, and exact name", async () => {
      await identity.recordCanonical("李应龙", "person/li-yinglong");
      await identity.addAlias("person/li-yinglong", "feishu_open_id", "ou_abc123");
      await identity.addAlias("person/li-yinglong", "email", "long@example.com");

      // exact name
      expect(await identity.resolveForExtraction("李应龙", "person/whatever")).toBe(
        "person/li-yinglong",
      );
      // slug (recordCanonical stored slug→slug)
      expect(await identity.resolveForExtraction("anything", "person/li-yinglong")).toBe(
        "person/li-yinglong",
      );
      // embedded open id
      expect(
        await identity.resolveForExtraction("Some Label (ou_abc123)", "person/some-label"),
      ).toBe("person/li-yinglong");
      // embedded email
      expect(await identity.resolveForExtraction("long@example.com", "person/foo")).toBe(
        "person/li-yinglong",
      );
    });

    it("returns null for an unknown handle", async () => {
      expect(await identity.resolveForExtraction("陌生人", "person/stranger")).toBeNull();
    });
  });

  describe("IdentityResolver integration (strong auto, weak explicit)", () => {
    it("a linked nickname pins the canonical slug", async () => {
      await pages.putPage("person/li-yinglong", personPage("person/li-yinglong", "李应龙"));
      await identity.addAlias("person/li-yinglong", "nickname", "龙哥");

      const resolver = new IdentityResolver(db.executor);
      const result = await resolver.canonicalizePersonSlug("龙哥", "person/long-ge");
      expect(result).toEqual({ slug: "person/li-yinglong", isAlias: true });
    });

    it("an UNLINKED nickname is never auto-merged — it stays its own person", async () => {
      const resolver = new IdentityResolver(db.executor);
      const result = await resolver.canonicalizePersonSlug("王哥", "person/wang-ge");
      // No handle exists for 王哥 → falls back to deterministic pinyin slug,
      // does NOT collapse into anyone else.
      expect(result.slug).toBe("person/wang-ge");
    });
  });

  describe("merge", () => {
    it("re-points links/timeline/tags, folds aliases+body, and deletes the old page", async () => {
      await pages.putPage("person/a", personPage("person/a", "Person A"));
      await pages.putPage(
        "person/b",
        personPage("person/b", "Person B", "B body", ["person/b-old"]),
      );
      await pages.putPage("project/x", personPage("project/x", "Project X"));

      // links: same outgoing on both (dedupe), plus an incoming to b
      await graph.addLink("person/a", "project/x", "works_on");
      await graph.addLink("person/b", "project/x", "works_on");
      await graph.addLink("project/x", "person/b", "mentions");
      // timeline + tags on b
      await timeline.addEntry("person/b", { date: "2024-01-01", summary: "B event" });
      await tags.addTag("person/b", "vip");
      await tags.addTag("person/a", "vip"); // dup → dedupe

      await identity.merge("person/b", "person/a");

      // old page gone
      expect(await pages.getPage("person/b")).toBeNull();

      // aliases folded into target (old slug + b's prior alias)
      const a = await pages.getPage("person/a");
      expect(a?.frontmatter.aliases).toEqual(expect.arrayContaining(["person/b", "person/b-old"]));
      expect(a?.compiled_truth).toContain("Merged from person/b");

      // outgoing link deduped to one
      const outgoing = await graph.getLinks("person/a");
      expect(
        outgoing.filter((l) => l.to_slug === "project/x" && l.link_type === "works_on"),
      ).toHaveLength(1);

      // incoming link re-pointed b → a
      const backlinks = await graph.getBacklinks("person/a");
      expect(backlinks.some((l) => l.from_slug === "project/x" && l.link_type === "mentions")).toBe(
        true,
      );

      // timeline + tags moved
      expect((await timeline.getTimeline("person/a")).some((t) => t.summary === "B event")).toBe(
        true,
      );
      expect(await tags.getTags("person/a")).toEqual(["vip"]);

      // future references to the old slug now resolve to the target
      expect(await identity.resolveHandle("slug", "person/b")).toBe("person/a");
    });

    it("refuses to merge a person into itself or a missing page", async () => {
      await pages.putPage("person/a", personPage("person/a", "A"));
      await expect(identity.merge("person/a", "person/a")).rejects.toThrow();
      await expect(identity.merge("person/ghost", "person/a")).rejects.toThrow(/not found/);
    });
  });

  describe("recanonicalize", () => {
    it("renames the page, keeps the old slug as a resolvable alias", async () => {
      await pages.putPage("person/yinglong-li", personPage("person/yinglong-li", "李应龙"));

      await identity.recanonicalize("person/yinglong-li", "person/li-yinglong");

      expect(await pages.getPage("person/yinglong-li")).toBeNull();
      const renamed = await pages.getPage("person/li-yinglong");
      expect(renamed).not.toBeNull();
      expect(renamed?.frontmatter.aliases).toContain("person/yinglong-li");
      expect(await identity.resolveHandle("slug", "person/yinglong-li")).toBe("person/li-yinglong");
    });

    it("refuses to rename onto an existing page", async () => {
      await pages.putPage("person/a", personPage("person/a", "A"));
      await pages.putPage("person/b", personPage("person/b", "B"));
      await expect(identity.recanonicalize("person/a", "person/b")).rejects.toThrow(/use merge/);
    });
  });
});
