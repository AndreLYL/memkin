import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(new Date(page2.updated_at).getTime()).toBeGreaterThan(new Date(firstUpdated).getTime());
  });

  it("getPage returns null for nonexistent slug", async () => {
    const page = await store.getPage("nonexistent");
    expect(page).toBeNull();
  });

  it("getPage returns page by slug", async () => {
    await store.putPage("entities/zhang-san", "---\ntitle: Zhang San\ntype: person\n---\nContext.");
    const page = await store.getPage("entities/zhang-san");
    expect(page).not.toBeNull();
    expect(page?.title).toBe("Zhang San");
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

  it("putPage accepts halflife_days and persists it as a real column", async () => {
    const content = "---\ntitle: Decision\ntype: decision\n---\nBody.";
    const page = await store.putPage("decisions/test-decision", content, { halflife_days: 90 });

    expect(page.halflife_days).toBe(90);

    const row = await db.pg.query<{ halflife_days: number | null }>(
      "SELECT halflife_days FROM pages WHERE slug = $1",
      ["decisions/test-decision"],
    );
    expect(row.rows[0].halflife_days).toBe(90);
  });

  it("putPage defaults halflife_days to NULL when not provided", async () => {
    const content = "---\ntitle: Entity\ntype: person\n---\nBody.";
    const page = await store.putPage("person/someone", content);

    expect(page.halflife_days).toBeNull();
  });

  it("putPage overwrites halflife_days on conflict with the newly provided value", async () => {
    const content = "---\ntitle: Decision\ntype: decision\n---\nBody.";
    await store.putPage("decisions/test-decision", content, { halflife_days: 90 });
    const updated = await store.putPage("decisions/test-decision", content, { halflife_days: 30 });

    expect(updated.halflife_days).toBe(30);
  });

  it("putPage resets halflife_days to NULL on conflict when opts is omitted", async () => {
    const content = "---\ntitle: Decision\ntype: decision\n---\nBody.";
    await store.putPage("decisions/test-decision", content, { halflife_days: 90 });
    const updated = await store.putPage("decisions/test-decision", content);

    expect(updated.halflife_days).toBeNull();
  });

  describe("lifecycle columns", () => {
    it("putPage sets tier=hot and expires_at from halflife_days on insert", async () => {
      const content = "---\ntitle: D1\ntype: decision\n---\nDecision body.";
      const page = await store.putPage("decisions/d1", content, { halflife_days: 90 });
      expect(page.tier).toBe("hot");
      expect(page.expires_at).not.toBeNull();
      const expiresAt = new Date(page.expires_at!);
      const expected = new Date(Date.now() + 90 * 86_400_000);
      expect(Math.abs(expiresAt.getTime() - expected.getTime())).toBeLessThan(5000);
    });

    it("putPage does NOT reset expires_at or tier on upsert conflict", async () => {
      const content = "---\ntitle: D1\ntype: decision\n---\nOriginal.";
      const page1 = await store.putPage("decisions/d1", content, { halflife_days: 90 });
      const originalExpiry = page1.expires_at;

      await store.updatePageTier(page1.id, "warm");

      const content2 = "---\ntitle: D1\ntype: decision\n---\nUpdated.";
      const page2 = await store.putPage("decisions/d1", content2, { halflife_days: 90 });
      expect(page2.tier).toBe("warm"); // tier preserved
      expect(page2.expires_at).toEqual(originalExpiry); // expires_at preserved
    });

    it("listExpiredHot returns only tier=hot pages past expires_at", async () => {
      await store.putPage("decisions/old", "---\ntitle: Old\ntype: decision\n---\nOld.", {
        halflife_days: 90,
      });
      await db.pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [
        "decisions/old",
      ]);

      await store.putPage("decisions/fresh", "---\ntitle: Fresh\ntype: decision\n---\nFresh.", {
        halflife_days: 90,
      });

      const expired = await store.listExpiredHot();
      expect(expired.map((p) => p.slug)).toContain("decisions/old");
      expect(expired.map((p) => p.slug)).not.toContain("decisions/fresh");
    });

    it("updatePageTier updates tier and optionally consolidated_into", async () => {
      const page = await store.putPage("pref/a", "---\ntitle: A\ntype: preference\n---\nA.", {
        halflife_days: 90,
      });
      const warm = await store.putPage(
        "warm/pref-consolidated",
        "---\ntitle: Warm\ntype: preference\n---\nMerged.",
        {
          halflife_days: null,
        },
      );

      await store.updatePageTier(page.id, "warm", warm.id);

      const updated = await store.getPage("pref/a");
      expect(updated?.tier).toBe("warm");
      expect(updated?.consolidated_into).toBe(warm.id);
    });

    it("listPagesByTier returns pages filtered by tier", async () => {
      await store.putPage("a", "---\ntitle: A\ntype: decision\n---\nA.", { halflife_days: 90 });
      await store.putPage("b", "---\ntitle: B\ntype: preference\n---\nB.", { halflife_days: 90 });
      await db.pg.query("UPDATE pages SET tier = 'warm' WHERE slug = 'b'");

      const hot = await store.listPagesByTier("hot");
      const warm = await store.listPagesByTier("warm");
      expect(hot.map((p) => p.slug)).toContain("a");
      expect(warm.map((p) => p.slug)).toContain("b");
      expect(hot.map((p) => p.slug)).not.toContain("b");
    });
  });
});
