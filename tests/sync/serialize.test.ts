import { describe, expect, it } from "vitest";
import type { LinkRow } from "../../src/store/graph.js";
import type { Page } from "../../src/store/pages.js";
import type { TimelineEntry } from "../../src/store/timeline.js";
import { serializePage, stripAliasesSection } from "../../src/sync/obsidian.js";

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 1,
    slug: "person/alice",
    type: "person",
    title: "Alice",
    compiled_truth: "## Context\n\nSenior engineer.",
    frontmatter: {},
    content_hash: "abc123",
    created_at: "2026-06-04T10:00:00Z",
    updated_at: "2026-06-04T10:00:00Z",
    ...overrides,
  };
}

describe("serializePage", () => {
  it("produces frontmatter + body with no links/timeline", () => {
    const result = serializePage(makePage(), [], [], [], false);

    expect(result).toContain("---");
    expect(result).toContain("title: Alice");
    expect(result).toContain("type: person");
    expect(result).toContain("slug: person/alice");
    expect(result).toContain("user_edited: false");
    expect(result).toContain("## Context\n\nSenior engineer.");
    expect(result).not.toContain("memkin:related");
    expect(result).not.toContain("memkin:timeline");
  });

  it("H1: explicit fields override frontmatter spread (no clobbering)", () => {
    const page = makePage({
      title: "RealTitle",
      type: "person",
      frontmatter: { title: "WrongTitle", type: "wrongtype", custom: "kept" },
    });
    const result = serializePage(page, [], [], [], false);

    expect(result).toContain("title: RealTitle");
    expect(result).not.toContain("title: WrongTitle");
    expect(result).toContain("type: person");
    expect(result).not.toContain("type: wrongtype");
    expect(result).toContain("custom: kept");
  });

  it("M1: does not write updated_at to frontmatter", () => {
    const result = serializePage(makePage(), [], [], [], false);
    expect(result).not.toMatch(/^updated_at:/m);
  });

  it("links rendered as [{target, type}] objects in frontmatter", () => {
    const links: LinkRow[] = [
      {
        from_slug: "person/alice",
        to_slug: "project/auth",
        link_type: "works_on",
        context: "",
      },
      {
        from_slug: "person/alice",
        to_slug: "person/bob",
        link_type: "obsidian",
        context: "",
      },
    ];
    const result = serializePage(makePage(), [], links, [], false);

    expect(result).toContain("target: project/auth");
    expect(result).toContain("type: works_on");
    expect(result).toContain("target: person/bob");
    expect(result).toContain("type: obsidian");
  });

  it("renders Related section with wikilinks when links present", () => {
    const links: LinkRow[] = [
      { from_slug: "x", to_slug: "project/auth", link_type: "works_on", context: "" },
      { from_slug: "x", to_slug: "person/bob", link_type: "obsidian", context: "" },
    ];
    const result = serializePage(makePage(), [], links, [], false);

    expect(result).toContain("<!-- memkin:related -->");
    expect(result).toContain("- [[project/auth]]");
    expect(result).toContain("- [[person/bob]]");
  });

  it("renders Timeline section with read-only warning", () => {
    const timeline: TimelineEntry[] = [
      {
        id: 1,
        page_id: 1,
        date: "2026-05-20",
        summary: "Decision: use JWT",
        detail: "",
        source: "feishu",
        created_at: "2026-05-20T00:00:00Z",
      },
    ];
    const result = serializePage(makePage(), [], [], timeline, false);

    expect(result).toContain("<!-- memkin:timeline -->");
    expect(result).toContain("⚠️ Timeline 为只读派生数据");
    expect(result).toContain("- **2026-05-20**: Decision: use JWT");
  });

  it("N3: rebuilds ## Aliases section from frontmatter.aliases", () => {
    const page = makePage({
      compiled_truth: "## Aliases\n\n- old-alias\n\n## Context\n\nBody.",
      frontmatter: { aliases: ["new-alias", "another"] },
    });
    const result = serializePage(page, [], [], [], false);

    // Old aliases stripped, new ones from frontmatter
    expect(result).not.toContain("old-alias");
    expect(result).toContain("- new-alias");
    expect(result).toContain("- another");
    // Context body preserved
    expect(result).toContain("## Context\n\nBody.");
    // Aliases section appears BEFORE the rest of body
    const aliasesIdx = result.indexOf("## Aliases");
    const contextIdx = result.indexOf("## Context");
    expect(aliasesIdx).toBeGreaterThan(0);
    expect(aliasesIdx).toBeLessThan(contextIdx);
  });

  it("N3: no Aliases section when frontmatter.aliases is empty or absent", () => {
    const page = makePage({
      compiled_truth: "## Aliases\n\n- old\n\n## Context\n\nBody.",
      frontmatter: {},
    });
    const result = serializePage(page, [], [], [], false);
    expect(result).not.toContain("## Aliases");
    expect(result).toContain("## Context\n\nBody.");
  });

  it("user_edited flag preserved correctly", () => {
    const result = serializePage(makePage(), [], [], [], true);
    expect(result).toContain("user_edited: true");
  });

  it("Unicode slug rendered correctly", () => {
    const page = makePage({
      slug: "person/王志冲",
      title: "王志冲",
    });
    const result = serializePage(page, [], [], [], false);
    expect(result).toContain("slug: person/王志冲");
    expect(result).toContain("title: 王志冲");
  });
});

describe("stripAliasesSection", () => {
  it("removes ## Aliases section at body start", () => {
    const body = "## Aliases\n\n- a\n- b\n\n## Context\n\nC.";
    expect(stripAliasesSection(body)).toBe("## Context\n\nC.");
  });

  it("returns body unchanged if no Aliases section", () => {
    const body = "## Context\n\nNo aliases here.";
    expect(stripAliasesSection(body)).toBe(body);
  });

  it("only strips Aliases at the very start, not mid-body", () => {
    const body = "## Context\n\n## Aliases\n\n- a";
    expect(stripAliasesSection(body)).toBe(body);
  });

  it("handles empty body", () => {
    expect(stripAliasesSection("")).toBe("");
  });
});
