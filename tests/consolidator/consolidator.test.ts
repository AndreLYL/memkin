import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { GraphStore } from "../../src/store/graph.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { Consolidator, type ConsolidatorStores } from "../../src/consolidator/consolidator.js";
import { canCompress, NEVER_COMPRESS_TYPES } from "../../src/consolidator/rules.js";

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
  await pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [
    slug,
  ]);
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
});
