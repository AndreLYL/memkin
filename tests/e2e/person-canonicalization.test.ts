/**
 * E2E regression test for person identity canonicalization
 *
 * Simulates the real Feishu extraction case where:
 * - Model generates person slugs with incorrect name order (e.g., wang-jian-du instead of wang-jiandu)
 * - Multiple mentions of the same person use different slug variants
 * - Links, decisions, tasks reference the old slugs
 *
 * Expected behavior:
 * - Only canonical person pages are created (e.g., person/wang-jiandu, person/li-yinglong)
 * - Old slugs are stored as aliases in frontmatter
 * - All references (links, decisions, tasks) are rewritten to canonical slugs
 * - Non-person entities are untouched
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoreAdapter } from "../../src/adapters/store.js";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import type { ExtractionResult, SourceRef } from "../../src/core/types.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

describe("Person Canonicalization E2E (Feishu Regression)", () => {
  let db: Database;
  let pageStore: PageStore;
  let identityResolver: IdentityResolver;
  let storeAdapter: StoreAdapter;

  beforeEach(async () => {
    db = await Database.create();

    pageStore = new PageStore(db.executor);
    identityResolver = new IdentityResolver(db.executor);
    storeAdapter = new StoreAdapter({
      pages: pageStore,
      chunks: new ChunkStore(db.executor),
      graph: new GraphStore(db.executor),
      tags: new TagStore(db.executor),
      timeline: new TimelineStore(db.executor),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("should canonicalize Feishu group chat with multiple person slug variants", async () => {
    // 1. Setup: Create ExtractionResult simulating real Feishu case
    const mockSource: SourceRef = {
      platform: "feishu",
      channel: "#product-team",
      timestamp: "2024-06-01T14:30:00Z",
      raw_hash: "feishu-regression-001",
      quote: "Group chat about Memkin project",
    };

    const extractionResult: ExtractionResult = {
      source: mockSource,
      entities: [
        // Person entities with WRONG slug order (model-generated)
        {
          slug: "person/wang-jian-du", // Wrong: should be wang-jiandu
          name: "王建都",
          type: "person",
          context: "PM at company",
          confidence: "direct",
        },
        {
          slug: "person/yinglong-li", // Wrong: should be li-yinglong (Chinese family name first)
          name: "李应龙",
          type: "person",
          context: "Developer",
          confidence: "direct",
        },
        {
          slug: "person/sylar", // Correct: Latin name
          name: "Sylar",
          type: "person",
          context: "AI researcher",
          confidence: "direct",
        },
        // Non-person entity (should be untouched)
        {
          slug: "project/memkin",
          name: "Memkin",
          type: "project",
          context: "Knowledge management system",
          confidence: "direct",
        },
      ],
      timeline: [
        {
          date: "2024-06-01",
          summary: "Project kickoff meeting",
          entities: ["person/wang-jian-du", "person/yinglong-li", "project/memkin"],
          source: mockSource,
          confidence: "direct",
        },
      ],
      links: [
        {
          from: "person/wang-jian-du",
          to: "project/memkin",
          type: "works_on",
          context: "王建都 leads Memkin project",
          confidence: "direct",
          source: mockSource,
        },
        {
          from: "person/yinglong-li",
          to: "project/memkin",
          type: "contributes_to",
          context: "李应龙 develops core features",
          confidence: "direct",
          source: mockSource,
        },
      ],
      decisions: [
        {
          summary: "Adopt person canonicalization strategy",
          reasoning: "Prevent duplicate person pages with different slug variants",
          entities: ["person/yinglong-li", "person/wang-jian-du", "project/memkin"],
          date: "2024-06-01",
          confidence: "direct",
          source: mockSource,
        },
      ],
      tasks: [
        {
          title: "Implement identity resolver",
          status: "open",
          owner: "person/yinglong-li", // Should be rewritten to person/li-yinglong
          confidence: "direct",
          source: mockSource,
        },
        {
          title: "Review implementation",
          status: "open",
          owner: "person/wang-jian-du", // Should be rewritten to person/wang-jiandu
          confidence: "direct",
          source: mockSource,
        },
      ],
      discoveries: [
        {
          summary: "Chinese names need special pinyin handling",
          type: "insight",
          entities: ["person/wang-jian-du", "person/yinglong-li"],
          source: mockSource,
          confidence: "direct",
        },
      ],
      knowledge: [],
    };

    // 2. Run canonicalization
    const { result: canonicalized, aliases } =
      await identityResolver.canonicalizeExtractionResult(extractionResult);

    // Convert aliases Map to Record for StoreAdapter
    const personAliases: Record<string, string[]> = {};
    for (const [canonicalSlug, aliasList] of aliases.entries()) {
      personAliases[canonicalSlug] = aliasList;
    }
    canonicalized.personAliases = personAliases;

    // 3. Push to store
    await storeAdapter.push([canonicalized]);

    // 4. Verify: Only canonical person pages exist
    const allPages = await pageStore.listPages({ limit: 100 });
    const personPages = allPages.filter((p) => p.slug.startsWith("person/"));
    const projectPages = allPages.filter((p) => p.slug.startsWith("project/"));

    // Should have exactly 3 person pages with canonical slugs
    expect(personPages).toHaveLength(3);
    const personSlugs = personPages.map((p) => p.slug).sort();
    expect(personSlugs).toEqual(["person/li-yinglong", "person/sylar", "person/wang-jiandu"]);

    // Should have 1 project page (untouched)
    expect(projectPages).toHaveLength(1);
    expect(projectPages[0].slug).toBe("project/memkin");

    // 5. Verify: Old slugs do NOT exist as pages
    const wangJianDuPage = await pageStore.getPage("person/wang-jian-du");
    expect(wangJianDuPage).toBeNull();

    const yinglongLiPage = await pageStore.getPage("person/yinglong-li");
    expect(yinglongLiPage).toBeNull();

    // 6. Verify: Canonical pages have aliases in frontmatter
    const wangJianduPage = await pageStore.getPage("person/wang-jiandu");
    expect(wangJianduPage).not.toBeNull();
    expect(wangJianduPage?.frontmatter?.aliases).toContain("person/wang-jian-du");

    const liYinglongPage = await pageStore.getPage("person/li-yinglong");
    expect(liYinglongPage).not.toBeNull();
    expect(liYinglongPage?.frontmatter?.aliases).toContain("person/yinglong-li");

    // 7. Verify: Links are rewritten to canonical slugs
    expect(canonicalized.links).toHaveLength(2);
    expect(canonicalized.links[0].from).toBe("person/wang-jiandu");
    expect(canonicalized.links[0].to).toBe("project/memkin");
    expect(canonicalized.links[1].from).toBe("person/li-yinglong");
    expect(canonicalized.links[1].to).toBe("project/memkin");

    // 8. Verify: Decision entities are rewritten
    expect(canonicalized.decisions[0].entities).toContain("person/li-yinglong");
    expect(canonicalized.decisions[0].entities).toContain("person/wang-jiandu");
    expect(canonicalized.decisions[0].entities).toContain("project/memkin");
    expect(canonicalized.decisions[0].entities).not.toContain("person/yinglong-li");
    expect(canonicalized.decisions[0].entities).not.toContain("person/wang-jian-du");

    // 9. Verify: Task owners are rewritten
    expect(canonicalized.tasks[0].owner).toBe("person/li-yinglong");
    expect(canonicalized.tasks[1].owner).toBe("person/wang-jiandu");

    // 10. Verify: Timeline entities are rewritten
    expect(canonicalized.timeline[0].entities).toContain("person/wang-jiandu");
    expect(canonicalized.timeline[0].entities).toContain("person/li-yinglong");
    expect(canonicalized.timeline[0].entities).toContain("project/memkin");

    // 11. Verify: Discovery entities are rewritten
    expect(canonicalized.discoveries[0].entities).toContain("person/wang-jiandu");
    expect(canonicalized.discoveries[0].entities).toContain("person/li-yinglong");

    // 12. Verify: Aliases map is populated
    expect(aliases.get("person/wang-jiandu")).toContain("person/wang-jian-du");
    expect(aliases.get("person/li-yinglong")).toContain("person/yinglong-li");
    expect(aliases.get("person/sylar")).toBeUndefined(); // No aliases for Sylar
  });
});
