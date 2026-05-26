import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";

describe("PageStore", () => {
  let db: Database;
  let store: PageStore;

  beforeEach(async () => {
    db = await Database.create();
    store = new PageStore(db.pg);
  });

  afterEach(async () => {
    await db.close();
  });

  it("putPage creates a new page and returns it", async () => {
    const content = [
      "---",
      "title: Test Page",
      "type: test",
      "---",
      "",
      "This is the compiled truth content.",
    ].join("\n");

    const page = await store.putPage("test/my-page", content);
    expect(page.slug).toBe("test/my-page");
    expect(page.title).toBe("Test Page");
    expect(page.type).toBe("test");
    expect(page.compiled_truth).toBe("This is the compiled truth content.");
    expect(page.content_hash).toBeTruthy();
    expect(page.id).toBeGreaterThan(0);
  });

  it("putPage upserts on slug conflict, always updates updated_at", async () => {
    const content1 = "---\ntitle: V1\ntype: test\n---\nOriginal.";
    const page1 = await store.putPage("my-slug", content1);
    const firstUpdated = page1.updated_at;

    await new Promise((r) => setTimeout(r, 10));

    const content2 = "---\ntitle: V2\ntype: test\n---\nUpdated.";
    const page2 = await store.putPage("my-slug", content2);

    expect(page2.id).toBe(page1.id);
    expect(page2.title).toBe("V2");
    expect(page2.compiled_truth).toBe("Updated.");
    expect(new Date(page2.updated_at).getTime()).toBeGreaterThan(
      new Date(firstUpdated).getTime()
    );
  });

  it("getPage returns null for nonexistent slug", async () => {
    const page = await store.getPage("nonexistent");
    expect(page).toBeNull();
  });

  it("getPage returns page by slug", async () => {
    await store.putPage("entities/zhang-san", "---\ntitle: Zhang San\ntype: person\n---\nContext.");
    const page = await store.getPage("entities/zhang-san");
    expect(page).not.toBeNull();
    expect(page!.title).toBe("Zhang San");
  });

  it("deletePage cascades", async () => {
    await store.putPage("to-delete", "---\ntitle: Temp\ntype: test\n---\nBody.");
    await store.deletePage("to-delete");
    const page = await store.getPage("to-delete");
    expect(page).toBeNull();
  });

  it("listPages returns all pages", async () => {
    await store.putPage("a", "---\ntitle: A\ntype: person\n---\nA.");
    await store.putPage("b", "---\ntitle: B\ntype: decision\n---\nB.");
    const pages = await store.listPages();
    expect(pages).toHaveLength(2);
  });

  it("listPages filters by type", async () => {
    await store.putPage("p1", "---\ntitle: P1\ntype: person\n---\nP1.");
    await store.putPage("d1", "---\ntitle: D1\ntype: decision\n---\nD1.");
    const persons = await store.listPages({ type: "person" });
    expect(persons).toHaveLength(1);
    expect(persons[0].type).toBe("person");
  });

  it("putPage stores extra frontmatter fields as JSONB", async () => {
    const content = [
      "---",
      "title: Decision",
      "type: decision",
      "date: 2026-05-25",
      "confidence: direct",
      "source_hash: abc123",
      "---",
      "Reasoning here.",
    ].join("\n");
    const page = await store.putPage("decisions/test", content);
    expect(page.frontmatter.date).toBe("2026-05-25");
    expect(page.frontmatter.confidence).toBe("direct");
    expect(page.frontmatter.source_hash).toBe("abc123");
  });

  it("listPages sorts by title ascending", async () => {
    await store.putPage("b-page", "---\ntitle: Bravo\ntype: unknown\n---\nB");
    await store.putPage("a-page", "---\ntitle: Alpha\ntype: unknown\n---\nA");
    const pages = await store.listPages({ sort: "title", order: "asc" });
    expect(pages[0].title).toBe("Alpha");
    expect(pages[1].title).toBe("Bravo");
  });

  it("listPages with limit=0 returns all pages", async () => {
    for (let i = 0; i < 5; i++) {
      await store.putPage(`page-${i}`, `---\ntitle: Page ${i}\ntype: unknown\n---\nContent ${i}`);
    }
    const pages = await store.listPages({ limit: 0 });
    expect(pages).toHaveLength(5);
  });

  it("listPages defaults to limit 50", async () => {
    const pages = await store.listPages();
    expect(Array.isArray(pages)).toBe(true);
  });
});
