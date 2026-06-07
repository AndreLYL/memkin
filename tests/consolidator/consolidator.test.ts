import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Consolidator, type ConsolidatorStores } from "../../src/consolidator/consolidator.js";
import { checkDeadLinks, type FetchFn } from "../../src/consolidator/dead-link.js";
import { inferPreferences } from "../../src/consolidator/infer-preferences.js";
import { canCompress, NEVER_COMPRESS_TYPES } from "../../src/consolidator/rules.js";
import type { LLMProvider } from "../../src/extractors/providers/types.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

// Helper: create a page and backdate its expires_at to simulate expiry
export async function makeExpiredHotPage(
  pages: PageStore,
  pg: Database["pg"],
  slug: string,
  type: string,
  entitySlug?: string,
  graph?: GraphStore,
): Promise<void> {
  await pages.putPage(slug, `---\ntitle: ${slug}\ntype: ${type}\n---\n${type} content.`, {
    halflife_days: 90,
  });
  await pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [slug]);
  if (entitySlug && graph) {
    await graph.addLink(slug, entitySlug, "mentions");
  }
}

describe("consolidator rules", () => {
  it("NEVER_COMPRESS_TYPES contains decision, reference, and entity types", () => {
    expect(NEVER_COMPRESS_TYPES.has("decision")).toBe(true);
    expect(NEVER_COMPRESS_TYPES.has("reference")).toBe(true);
    expect(NEVER_COMPRESS_TYPES.has("person")).toBe(true);
    expect(NEVER_COMPRESS_TYPES.has("project")).toBe(true);
  });

  it("canCompress returns false for never-compress types", () => {
    expect(canCompress("decision")).toBe(false);
    expect(canCompress("reference")).toBe(false);
    expect(canCompress("person")).toBe(false);
  });

  it("canCompress returns true for compressible types", () => {
    expect(canCompress("preference")).toBe(true);
    expect(canCompress("knowledge")).toBe(true);
    expect(canCompress("discovery")).toBe(true);
    expect(canCompress("task")).toBe(true);
  });
});

describe("Consolidator", () => {
  let db: Database;
  let stores: ConsolidatorStores;

  beforeEach(async () => {
    db = await Database.create();
    stores = {
      pages: new PageStore(db.pg),
      graph: new GraphStore(db.pg),
      tags: new TagStore(db.pg),
      timeline: new TimelineStore(db.pg),
    };
  });

  afterEach(async () => {
    await db.close();
  });

  it("Consolidator can be instantiated and has runOnce method", () => {
    const consolidator = new Consolidator(stores);
    expect(typeof consolidator.runOnce).toBe("function");
    expect(typeof consolidator.start).toBe("function");
    expect(typeof consolidator.stop).toBe("function");
  });

  it("runOnce returns zero counts when no pages to consolidate", async () => {
    const consolidator = new Consolidator(stores);
    const result = await consolidator.runOnce("hot");
    expect(result.hotToWarm).toBe(0);
  });

  describe("consolidateHot", () => {
    it("moves expired hot pages for never-compress types to warm without merging", async () => {
      await makeExpiredHotPage(stores.pages, db.pg, "decisions/d1", "decision");

      const consolidator = new Consolidator(stores);
      const moved = await consolidator.consolidateHot();
      expect(moved).toBe(1);

      const d1 = await stores.pages.getPage("decisions/d1");
      expect(d1?.tier).toBe("warm");
      expect(d1?.compiled_truth).toBe("decision content."); // content unchanged
    });

    it("merges expired hot pages for compressible types by entity+type into one warm page", async () => {
      await stores.pages.putPage(
        "entities/alice",
        "---\ntitle: Alice\ntype: person\n---\nAlice entity.",
      );
      await makeExpiredHotPage(
        stores.pages,
        db.pg,
        "preferences/pref1",
        "preference",
        "entities/alice",
        stores.graph,
      );
      await makeExpiredHotPage(
        stores.pages,
        db.pg,
        "preferences/pref2",
        "preference",
        "entities/alice",
        stores.graph,
      );

      const consolidator = new Consolidator(stores);
      const moved = await consolidator.consolidateHot();
      expect(moved).toBe(2);

      const pref1 = await stores.pages.getPage("preferences/pref1");
      const pref2 = await stores.pages.getPage("preferences/pref2");
      expect(pref1?.tier).toBe("warm");
      expect(pref2?.tier).toBe("warm");
      // Both should point to the same consolidated warm page
      expect(pref1?.consolidated_into).toBe(pref2?.consolidated_into);
      expect(pref1?.consolidated_into).not.toBeNull();

      // Verify the warm aggregate page has correct merged content and source_slugs
      const warmPage = await stores.pages.getPage("warm/entities-alice/preference-consolidated");
      expect(warmPage).not.toBeNull();
      expect(warmPage?.compiled_truth).toContain("preferences/pref1");
      expect(warmPage?.compiled_truth).toContain("preferences/pref2");
      const sourceSlugs = warmPage?.frontmatter.source_slugs as string[];
      expect(sourceSlugs).toContain("preferences/pref1");
      expect(sourceSlugs).toContain("preferences/pref2");
    });

    it("does NOT merge or rewrite pages where frontmatter.user_edited === true (H4 rule)", async () => {
      await stores.pages.putPage(
        "preferences/user-edited",
        "---\ntitle: User-edited pref\ntype: preference\nuser_edited: true\n---\nHand-written content.",
        { halflife_days: 90 },
      );
      await db.pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [
        "preferences/user-edited",
      ]);

      const consolidator = new Consolidator(stores);
      await consolidator.consolidateHot();

      const page = await stores.pages.getPage("preferences/user-edited");
      // Tier advances to warm (allowed — only content is protected)
      expect(page?.tier).toBe("warm");
      // Content unchanged
      expect(page?.compiled_truth).toBe("Hand-written content.");
      // NOT merged into a group warm page
      expect(page?.consolidated_into).toBeNull();
    });

    it("is idempotent: running consolidateHot twice does not create duplicate warm pages", async () => {
      await stores.pages.putPage("entities/bob", "---\ntitle: Bob\ntype: person\n---\nBob entity.");
      await makeExpiredHotPage(
        stores.pages,
        db.pg,
        "preferences/p1",
        "preference",
        "entities/bob",
        stores.graph,
      );
      await makeExpiredHotPage(
        stores.pages,
        db.pg,
        "preferences/p2",
        "preference",
        "entities/bob",
        stores.graph,
      );

      const consolidator = new Consolidator(stores);
      await consolidator.consolidateHot();
      const beforeCount = (await stores.pages.listPagesByTier("warm")).length;

      await consolidator.consolidateHot();
      const afterCount = (await stores.pages.listPagesByTier("warm")).length;

      expect(afterCount).toBe(beforeCount); // no duplicates
    });
  });

  describe("consolidateWarm", () => {
    it("creates a cold summary page for a warm entity group via LLM", async () => {
      const mockLlm: LLMProvider = {
        async chat() {
          return "Alice prefers morning meetings and tends to complete work on Tuesdays.";
        },
      };

      await stores.pages.putPage(
        "entities/alice",
        "---\ntitle: Alice\ntype: person\n---\nAlice entity.",
      );

      // Create a warm preference page linked to alice (simulating result of consolidateHot)
      await stores.pages.putPage(
        "warm/entities-alice/preference-consolidated",
        "---\ntitle: Consolidated preference (entities/alice)\ntype: preference\nconsolidated: true\n---\nAlice likes morning standups.",
        { halflife_days: null },
      );
      await db.pg.query(
        `UPDATE pages SET
           tier = 'warm',
           created_at = NOW() - INTERVAL '400 days',
           frontmatter = frontmatter || '{"created_at": "2025-01-01T00:00:00.000Z"}'::jsonb
         WHERE slug = $1`,
        ["warm/entities-alice/preference-consolidated"],
      );
      await stores.graph.addLink(
        "warm/entities-alice/preference-consolidated",
        "entities/alice",
        "mentions",
      );

      const consolidator = new Consolidator(stores, mockLlm);
      const result = await consolidator.consolidateWarm();
      expect(result.warmToCold).toBeGreaterThan(0);

      const coldPage = await stores.pages.getPage("cold/entities/alice");
      expect(coldPage).not.toBeNull();
      expect(coldPage?.tier).toBe("cold");
      expect(coldPage?.compiled_truth).toContain("Alice prefers morning meetings");
    });

    it("does NOT compress pages that are too young for warm→cold threshold", async () => {
      const mockLlm: LLMProvider = {
        async chat() {
          return "Summary.";
        },
      };

      await stores.pages.putPage("entities/bob", "---\ntitle: Bob\ntype: person\n---\nBob entity.");
      // Fresh warm page (created recently, not yet past WARM_TO_COLD_DAYS threshold)
      await stores.pages.putPage(
        "warm/entities-bob/preference-consolidated",
        "---\ntitle: Consolidated preference\ntype: preference\nconsolidated: true\n---\nBob likes evening calls.",
        { halflife_days: null },
      );
      await db.pg.query("UPDATE pages SET tier = 'warm' WHERE slug = $1", [
        "warm/entities-bob/preference-consolidated",
      ]);
      await stores.graph.addLink(
        "warm/entities-bob/preference-consolidated",
        "entities/bob",
        "mentions",
      );

      const consolidator = new Consolidator(stores, mockLlm);
      const result = await consolidator.consolidateWarm();
      expect(result.warmToCold).toBe(0);

      const coldPage = await stores.pages.getPage("cold/entities/bob");
      expect(coldPage).toBeNull(); // too young
    });

    it("throws if consolidateWarm is called without an LLM provider", async () => {
      const consolidator = new Consolidator(stores);
      await expect(consolidator.consolidateWarm()).rejects.toThrow(
        "LLM provider required for warm→cold consolidation",
      );
    });
  });

  describe("dead-link checker", () => {
    it("marks reference page as dead_link=true when URL returns non-200", async () => {
      const mockFetch: FetchFn = async (url) => {
        if (url === "https://dead.example.com") return { ok: false, status: 404 };
        return { ok: true, status: 200 };
      };

      await stores.pages.putPage(
        "references/dead-ref",
        [
          "---",
          "title: Dead Reference",
          "type: reference",
          "url: https://dead.example.com",
          "dead_link: false",
          "---",
          "",
          "This link is dead.",
        ].join("\n"),
        { halflife_days: null },
      );

      const checked = await checkDeadLinks(stores.pages, mockFetch);
      expect(checked).toBe(1);

      const page = await stores.pages.getPage("references/dead-ref");
      expect(page?.frontmatter.dead_link).toBe(true);
      expect(page?.frontmatter.last_checked_at).toBeDefined();
    });

    it("marks reference page as dead_link=false when URL returns 200", async () => {
      const mockFetch: FetchFn = async () => ({ ok: true, status: 200 });

      await stores.pages.putPage(
        "references/live-ref",
        [
          "---",
          "title: Live Reference",
          "type: reference",
          "url: https://live.example.com",
          "dead_link: false",
          "---",
          "",
          "This link works.",
        ].join("\n"),
        { halflife_days: null },
      );

      const checked = await checkDeadLinks(stores.pages, mockFetch);
      expect(checked).toBe(1);

      const page = await stores.pages.getPage("references/live-ref");
      expect(page?.frontmatter.dead_link).toBe(false);
    });

    it("skips reference pages checked within the last 30 days", async () => {
      const mockFetch: FetchFn = async () => ({ ok: true, status: 200 });
      const recentCheck = new Date(Date.now() - 5 * 86_400_000).toISOString(); // 5 days ago

      await stores.pages.putPage(
        "references/recent-ref",
        [
          "---",
          "title: Recently Checked",
          "type: reference",
          `url: https://example.com`,
          `last_checked_at: "${recentCheck}"`,
          "---",
          "",
          "Recent.",
        ].join("\n"),
        { halflife_days: null },
      );

      const checked = await checkDeadLinks(stores.pages, mockFetch);
      expect(checked).toBe(0); // skipped
    });

    it("preserves halflife_days, expires_at, and extra frontmatter after checking", async () => {
      const mockFetch: FetchFn = async () => ({ ok: true, status: 200 });

      await stores.pages.putPage(
        "references/preserved-ref",
        [
          "---",
          "title: Preserved Reference",
          "type: reference",
          "url: https://example.com",
          "confidence: direct",
          "source_hash: abc123",
          "---",
          "",
          "Body content.",
        ].join("\n"),
        { halflife_days: null },
      );

      // Record initial state
      const before = await stores.pages.getPage("references/preserved-ref");
      expect(before).not.toBeNull();

      await checkDeadLinks(stores.pages, mockFetch);

      const after = await stores.pages.getPage("references/preserved-ref");
      expect(after?.halflife_days).toBe(before?.halflife_days);
      expect(after?.tier).toBe(before?.tier);
      expect(after?.frontmatter.confidence).toBe("direct");
      expect(after?.frontmatter.source_hash).toBe("abc123");
      expect(after?.frontmatter.dead_link).toBe(false);
      expect(after?.frontmatter.last_checked_at).toBeDefined();
    });

    it("marks reference page as dead_link=true when fetchFn throws", async () => {
      const mockFetch: FetchFn = async () => {
        throw new Error("Network error");
      };

      await stores.pages.putPage(
        "references/error-ref",
        [
          "---",
          "title: Error Reference",
          "type: reference",
          "url: https://unreachable.example.com",
          "---",
          "",
          "Unreachable.",
        ].join("\n"),
        { halflife_days: null },
      );

      const checked = await checkDeadLinks(stores.pages, mockFetch);
      expect(checked).toBe(1);

      const page = await stores.pages.getPage("references/error-ref");
      expect(page?.frontmatter.dead_link).toBe(true);
    });
  });

  describe("preference inference", () => {
    it("infers scheduling preference from timeline patterns via LLM", async () => {
      const mockLlm: LLMProvider = {
        async chat() {
          return JSON.stringify([
            {
              summary: "偏好下午开会",
              category: "scheduling",
              confidence: "inferred",
            },
          ]);
        },
      };

      await stores.pages.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
      // Create timeline entries for the entity — all in the afternoon
      for (let i = 0; i < 6; i++) {
        await stores.timeline.addEntry("entities/alice", {
          date: `2026-05-${10 + i}`,
          summary: `Meeting at 14:0${i}`,
          detail: `Alice's meeting at 14:0${i}`,
        });
      }

      const inferred = await inferPreferences(stores, mockLlm);
      expect(inferred).toBeGreaterThan(0);

      const prefPage = await stores.pages.listPages({ type: "preference" });
      const inferredPrefs = prefPage.filter((p) => p.frontmatter.inferred === true);
      expect(inferredPrefs.length).toBeGreaterThan(0);
    });

    it("returns 0 when LLM returns empty array (no clear patterns)", async () => {
      const mockLlm: LLMProvider = {
        async chat() {
          return "[]";
        },
      };

      await stores.pages.putPage(
        "entities/charlie",
        "---\ntitle: Charlie\ntype: person\n---\nCharlie.",
      );
      await stores.timeline.addEntry("entities/charlie", {
        date: "2026-05-10",
        summary: "Random meeting",
      });

      const inferred = await inferPreferences(stores, mockLlm);
      expect(inferred).toBe(0);
    });
  });
});
