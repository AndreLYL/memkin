import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Consolidator, type ConsolidatorStores } from "../../src/consolidator/consolidator.js";
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
});
