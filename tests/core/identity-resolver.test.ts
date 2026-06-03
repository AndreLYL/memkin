/**
 * Tests for IdentityResolver
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import type { ExtractionResult, SourceRef } from "../../src/core/types.js";
import * as personSlug from "../../src/core/person-slug.js";

const SCHEMA_PATH = resolve(__dirname, "../../src/store/schema.sql");

describe("IdentityResolver", () => {
  let db: PGlite;
  let resolver: IdentityResolver;

  beforeEach(async () => {
    db = new PGlite({ extensions: { vector } });
    const schema = readFileSync(SCHEMA_PATH, "utf-8");
    await db.exec(schema);
    resolver = new IdentityResolver(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("canonicalizePersonSlug", () => {
    it("should return canonical slug for Chinese name on fresh cache", async () => {
      const result = await resolver.canonicalizePersonSlug("王建都", "person/wang-jian-du");

      expect(result).toEqual({
        slug: "person/wang-jiandu",
        isAlias: true,
      });

      // Verify cache was populated
      const cache = await db.query(
        "SELECT * FROM identity_cache WHERE platform = 'canonical' ORDER BY external_id",
      );
      expect(cache.rows).toHaveLength(2);
      expect(cache.rows).toContainEqual(
        expect.objectContaining({
          platform: "canonical",
          external_id: "person/wang-jian-du",
          display_name: "person/wang-jiandu",
          slug_hint: "王建都",
        }),
      );
      expect(cache.rows).toContainEqual(
        expect.objectContaining({
          platform: "canonical",
          external_id: "王建都",
          display_name: "person/wang-jiandu",
          slug_hint: "王建都",
        }),
      );
    });

    it("should return cached result on second call with same inputs", async () => {
      // First call
      await resolver.canonicalizePersonSlug("王建都", "person/wang-jian-du");

      // Spy on db.query to verify cache hit
      const querySpy = vi.spyOn(db, "query");
      const initialCallCount = querySpy.mock.calls.length;

      // Second call
      const result = await resolver.canonicalizePersonSlug("王建都", "person/wang-jian-du");

      expect(result).toEqual({
        slug: "person/wang-jiandu",
        isAlias: true,
      });

      // Should only have 1 SELECT (cache lookup by modelSlug), no INSERTs
      const newCalls = querySpy.mock.calls.slice(initialCallCount);
      const selectCalls = newCalls.filter((call) =>
        call[0].toString().toUpperCase().includes("SELECT"),
      );
      const insertCalls = newCalls.filter((call) =>
        call[0].toString().toUpperCase().includes("INSERT"),
      );

      expect(selectCalls.length).toBeGreaterThan(0);
      expect(insertCalls.length).toBe(0);
    });

    it("should return same canonical slug for same name with different model slugs", async () => {
      // First variant
      const result1 = await resolver.canonicalizePersonSlug("王建都", "person/wang-jiandu");
      expect(result1).toEqual({
        slug: "person/wang-jiandu",
        isAlias: false,
      });

      // Second variant
      const result2 = await resolver.canonicalizePersonSlug("王建都", "person/wang-jian-du");
      expect(result2).toEqual({
        slug: "person/wang-jiandu",
        isAlias: true,
      });

      // Both should resolve to the same canonical slug
      expect(result1.slug).toBe(result2.slug);
    });

    it("should merge Feishu open id slugs that differ only by underscore normalization", async () => {
      const result1 = await resolver.canonicalizePersonSlug(
        "ou_10d417bea2263b13b0112f8067334323",
        "person/ou_10d417bea2263b13b0112f8067334323",
      );
      expect(result1).toEqual({
        slug: "person/ou_10d417bea2263b13b0112f8067334323",
        isAlias: false,
      });

      const result2 = await resolver.canonicalizePersonSlug(
        "ou_10d417bea2263b13b0112f8067334323",
        "person/ou-10d417bea2263b13b0112f8067334323",
      );
      expect(result2).toEqual({
        slug: "person/ou_10d417bea2263b13b0112f8067334323",
        isAlias: true,
      });
    });

    it("should merge generic Feishu user labels that contain the same open id", async () => {
      const result1 = await resolver.canonicalizePersonSlug(
        "ou_10d417bea2263b13b0112f8067334323",
        "person/ou_10d417bea2263b13b0112f8067334323",
      );
      expect(result1.slug).toBe("person/ou_10d417bea2263b13b0112f8067334323");

      const result2 = await resolver.canonicalizePersonSlug(
        "Feishu User (ou_10d417bea2263b13b0112f8067334323)",
        "person/feishu-user",
      );
      expect(result2).toEqual({
        slug: "person/ou_10d417bea2263b13b0112f8067334323",
        isAlias: true,
      });

      const result3 = await resolver.canonicalizePersonSlug(
        "User ou_10d417bea2263b13b0112f8067334323",
        "person/user-ou_10d417bea2263b13b0112f8067334323",
      );
      expect(result3).toEqual({
        slug: "person/ou_10d417bea2263b13b0112f8067334323",
        isAlias: true,
      });
    });

    it("should keep original slug on collision", async () => {
      // Mock toPersonCanonicalSlug to simulate collision
      const mockToPersonCanonicalSlug = vi.spyOn(personSlug, "toPersonCanonicalSlug");
      mockToPersonCanonicalSlug.mockReturnValue("person/wang-jiandu");

      // First person establishes canonical slug
      await resolver.canonicalizePersonSlug("王建都", "person/wang-jian-du");

      // Second person with different name but same pinyin slug (collision)
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await resolver.canonicalizePersonSlug("王健都", "person/wang-jian-du-2");

      expect(result).toEqual({
        slug: "person/wang-jian-du-2", // Keeps original
        isAlias: false,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Slug collision detected"),
      );

      consoleSpy.mockRestore();
      mockToPersonCanonicalSlug.mockRestore();
    });

    it("should return original slug when toPersonCanonicalSlug returns null", async () => {
      // Mock toPersonCanonicalSlug to return null (e.g., Arabic name)
      const mockToPersonCanonicalSlug = vi.spyOn(personSlug, "toPersonCanonicalSlug");
      mockToPersonCanonicalSlug.mockReturnValue(null);

      const result = await resolver.canonicalizePersonSlug("أحمد", "person/arabic-name");

      expect(result).toEqual({
        slug: "person/arabic-name",
        isAlias: false,
      });

      mockToPersonCanonicalSlug.mockRestore();
    });

    it("should return canonical slug for Latin name", async () => {
      const result = await resolver.canonicalizePersonSlug("Sylar", "person/sylar");

      expect(result).toEqual({
        slug: "person/sylar",
        isAlias: false,
      });
    });
  });

  describe("canonicalizeExtractionResult", () => {
    const mockSource: SourceRef = {
      platform: "test",
      channel: "test-channel",
      timestamp: "2024-01-01T00:00:00Z",
      raw_hash: "test-hash",
      quote: "test quote",
    };

    it("should merge person entities with different slug variants", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "context 1",
            confidence: "direct",
          },
          {
            slug: "person/wang-jiandu",
            name: "王建都",
            type: "person",
            context: "context 2",
            confidence: "paraphrased",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized, aliases } = await resolver.canonicalizeExtractionResult(
        result,
      );

      // Should have only one entity
      expect(canonicalized.entities).toHaveLength(1);
      expect(canonicalized.entities[0].slug).toBe("person/wang-jiandu");
      // Should keep first entity's context
      expect(canonicalized.entities[0].context).toBe("context 1");

      // Aliases should map the non-canonical slug
      expect(aliases.get("person/wang-jiandu")).toContain("person/wang-jian-du");
    });

    it("should rewrite links referencing old slugs", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [
          {
            from: "person/wang-jian-du",
            to: "project/foo",
            type: "works_on",
            context: "link context",
            confidence: "direct",
            source: mockSource,
          },
          {
            from: "project/bar",
            to: "person/wang-jian-du",
            type: "mentions",
            context: "another link",
            confidence: "direct",
            source: mockSource,
          },
        ],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      expect(canonicalized.links).toHaveLength(2);
      expect(canonicalized.links[0].from).toBe("person/wang-jiandu");
      expect(canonicalized.links[0].to).toBe("project/foo");
      expect(canonicalized.links[1].from).toBe("project/bar");
      expect(canonicalized.links[1].to).toBe("person/wang-jiandu");
    });

    it("should rewrite decision entities", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [
          {
            summary: "Decision made",
            entities: ["person/wang-jian-du", "project/foo"],
            date: "2024-01-01",
            confidence: "direct",
            source: mockSource,
          },
        ],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      expect(canonicalized.decisions[0].entities).toContain("person/wang-jiandu");
      expect(canonicalized.decisions[0].entities).toContain("project/foo");
      expect(canonicalized.decisions[0].entities).not.toContain("person/wang-jian-du");
    });

    it("should rewrite task owner with person slug", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/yinglong-li", // This is the model-generated slug (wrong order)
            name: "李应龙", // Name is 李应龙
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [
          {
            title: "Complete task",
            status: "open",
            owner: "person/yinglong-li", // Same slug as entity
            confidence: "direct",
            source: mockSource,
          },
        ],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      // Should rewrite to canonical Chinese name order: li-yinglong
      expect(canonicalized.tasks[0].owner).toBe("person/li-yinglong");
    });

    it("should not touch non-person entities", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
          {
            slug: "project/foo",
            name: "Foo Project",
            type: "project",
            context: "project entity",
            confidence: "direct",
          },
          {
            slug: "organization/bar",
            name: "Bar Org",
            type: "organization",
            context: "org entity",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      const nonPersonEntities = canonicalized.entities.filter((e) => e.type !== "person");
      expect(nonPersonEntities).toHaveLength(2);
      expect(nonPersonEntities[0].slug).toBe("project/foo");
      expect(nonPersonEntities[1].slug).toBe("organization/bar");
    });

    it("should not touch non-person slugs in links", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [],
        timeline: [],
        links: [
          {
            from: "project/foo",
            to: "project/bar",
            type: "depends_on",
            context: "link context",
            confidence: "direct",
            source: mockSource,
          },
        ],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      expect(canonicalized.links[0].from).toBe("project/foo");
      expect(canonicalized.links[0].to).toBe("project/bar");
    });

    it("should rewrite timeline entities", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
        ],
        timeline: [
          {
            date: "2024-01-01",
            summary: "Event happened",
            entities: ["person/wang-jian-du", "project/foo"],
            source: mockSource,
            confidence: "direct",
          },
        ],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      expect(canonicalized.timeline[0].entities).toContain("person/wang-jiandu");
      expect(canonicalized.timeline[0].entities).toContain("project/foo");
      expect(canonicalized.timeline[0].entities).not.toContain("person/wang-jian-du");
    });

    it("should rewrite discovery entities", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [
          {
            summary: "Discovery made",
            type: "insight",
            entities: ["person/wang-jian-du", "project/foo"],
            source: mockSource,
            confidence: "direct",
          },
        ],
        knowledge: [],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      expect(canonicalized.discoveries[0].entities).toContain("person/wang-jiandu");
      expect(canonicalized.discoveries[0].entities).toContain("project/foo");
      expect(canonicalized.discoveries[0].entities).not.toContain("person/wang-jian-du");
    });

    it("should rewrite knowledge related entities", async () => {
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "person entity",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [
          {
            topic: "Topic",
            content: "Content",
            source_type: "conversation",
            related_entities: ["person/wang-jian-du", "project/foo"],
            source: mockSource,
            confidence: "direct",
          },
        ],
      };

      const { result: canonicalized } = await resolver.canonicalizeExtractionResult(result);

      expect(canonicalized.knowledge[0].related_entities).toContain("person/wang-jiandu");
      expect(canonicalized.knowledge[0].related_entities).toContain("project/foo");
      expect(canonicalized.knowledge[0].related_entities).not.toContain("person/wang-jian-du");
    });
  });
});
