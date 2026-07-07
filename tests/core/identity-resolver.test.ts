/**
 * Tests for IdentityResolver
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityBackend } from "../../src/core/identity-resolver.js";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import * as personSlug from "../../src/core/person-slug.js";
import type { ExtractionResult, SourceRef } from "../../src/core/types.js";
import { Database } from "../../src/store/database.js";
import type { SqlExecutor } from "../../src/store/sql-executor.js";

describe("IdentityResolver", () => {
  let database: Database;
  let db: SqlExecutor;
  let resolver: IdentityResolver;

  beforeEach(async () => {
    database = await Database.create();
    db = database.executor;
    resolver = new IdentityResolver(db);
  });

  afterEach(async () => {
    await database.close();
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

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Slug collision detected"));

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

      const { result: canonicalized, aliases } =
        await resolver.canonicalizeExtractionResult(result);

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

// ── Entity normalization: tiered strong-handle binding (spec §9, PR-3) ──────

describe("IdentityResolver entity normalization (project/tool)", () => {
  let database: Database;
  let db: SqlExecutor;
  let resolver: IdentityResolver;

  beforeEach(async () => {
    database = await Database.create();
    db = database.executor;
    resolver = new IdentityResolver(db);
  });

  afterEach(async () => {
    await database.close();
  });

  async function insertPage(slug: string, type: string, title: string): Promise<void> {
    await db.query("INSERT INTO pages (slug, type, title, compiled_truth) VALUES ($1,$2,$3,$4)", [
      slug,
      type,
      title,
      "body",
    ]);
  }

  describe("canonicalizeEntitySlug", () => {
    it("binds via an existing entity handle in the same namespace", async () => {
      await db.query(
        `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug)
         VALUES ('project', 'global', 'name', 'Memkin', 'project/memkin')`,
      );
      const r = await resolver.canonicalizeEntitySlug("project", "Memkin", "project/memkin-v2");
      expect(r.slug).toBe("project/memkin");
      expect(r.isAlias).toBe(true);
      expect(r.suggestions).toEqual([]);
    });

    it("auto-binds when exactly one same-type page has the exact name and no cross-type clash", async () => {
      await insertPage("project/memkin", "project", "Memkin");
      const r = await resolver.canonicalizeEntitySlug("project", "Memkin", "project/memkin-x");
      expect(r.slug).toBe("project/memkin");
      expect(r.isAlias).toBe(true);
      expect(r.suggestions).toEqual([]);
      // The bind is recorded as a strong name handle for future resolutions.
      const handle = await db.query<{ canonical_slug: string }>(
        `SELECT canonical_slug FROM entity_handles
         WHERE entity_type = 'project' AND kind = 'name' AND value = 'Memkin'`,
      );
      expect(handle.rows).toEqual([{ canonical_slug: "project/memkin" }]);
    });

    it("does NOT bind when multiple same-type pages share the exact name — suggestion only", async () => {
      await insertPage("tool/larkclihttpclient", "tool", "LarkCliHttpClient");
      await insertPage("tool/lark-cli-http-client", "tool", "LarkCliHttpClient");
      const r = await resolver.canonicalizeEntitySlug(
        "tool",
        "LarkCliHttpClient",
        "tool/lark-cli-http",
      );
      expect(r.slug).toBe("tool/lark-cli-http"); // keeps model slug
      expect(r.isAlias).toBe(false);
      expect(r.suggestions.length).toBeGreaterThan(0);
      for (const s of r.suggestions) {
        expect(s.reason).toBe("same_name");
        expect(s.entity_type).toBe("tool");
      }
      // No auto-created handle.
      const handle = await db.query(
        "SELECT 1 FROM entity_handles WHERE entity_type = 'tool' AND kind = 'name' AND value = 'LarkCliHttpClient'",
      );
      expect(handle.rows).toHaveLength(0);
    });

    it("does NOT bind on cross-type name clash (Codex the tool vs Codex the project) — suggestion only", async () => {
      await insertPage("tool/codex", "tool", "Codex");
      const r = await resolver.canonicalizeEntitySlug("project", "Codex", "project/codex");
      expect(r.slug).toBe("project/codex"); // keeps model slug
      expect(r.isAlias).toBe(false);
      expect(r.suggestions).toEqual([
        expect.objectContaining({
          reason: "cross_type_name",
          from_slug: "project/codex",
          into_slug: "tool/codex",
        }),
      ]);
      const handle = await db.query(
        "SELECT 1 FROM entity_handles WHERE kind = 'name' AND value = 'Codex'",
      );
      expect(handle.rows).toHaveLength(0);
    });

    it("near-miss names (Levenshtein-close) never auto-bind", async () => {
      await insertPage("tool/lark-cli-http-client", "tool", "LarkCliHttpClient");
      // Case-different / near name is NOT an exact match — must not bind.
      const r = await resolver.canonicalizeEntitySlug("tool", "LarkCLIHttpClient", "tool/lark-x");
      expect(r.slug).toBe("tool/lark-x");
      expect(r.isAlias).toBe(false);
    });

    it("records name handle for a brand-new entity so slug variants converge", async () => {
      const first = await resolver.canonicalizeEntitySlug(
        "project",
        "记忆系统",
        "project/memory-system",
      );
      expect(first.slug).toBe("project/memory-system");
      expect(first.isAlias).toBe(false);

      const second = await resolver.canonicalizeEntitySlug(
        "project",
        "记忆系统",
        "project/jiyi-xitong",
      );
      expect(second.slug).toBe("project/memory-system"); // converges on first slug
      expect(second.isAlias).toBe(true);
    });
  });

  describe("canonicalizeExtractionResult with project/tool entities", () => {
    const mockSource: SourceRef = {
      platform: "test",
      channel: "test-channel",
      timestamp: "2024-01-01T00:00:00Z",
      raw_hash: "test-hash",
      quote: "test quote",
    };

    it("rewrites project/tool slugs to their canonical pages and dedupes", async () => {
      await insertPage("project/memkin", "project", "Memkin");
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "project/memkin-v2",
            name: "Memkin",
            type: "project",
            context: "ctx",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [
          {
            from: "project/memkin-v2",
            to: "person/alice",
            type: "mentions",
            context: "c",
            confidence: "direct",
            source: mockSource,
          },
        ],
        decisions: [
          {
            summary: "d",
            entities: ["project/memkin-v2"],
            date: "2024-01-01",
            confidence: "direct",
            source: mockSource,
          },
        ],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const { result: canonicalized, suggestions } =
        await resolver.canonicalizeExtractionResult(result);
      expect(canonicalized.entities[0].slug).toBe("project/memkin");
      expect(canonicalized.links[0].from).toBe("project/memkin");
      expect(canonicalized.decisions[0].entities).toEqual(["project/memkin"]);
      expect(suggestions).toEqual([]);
    });

    it("surfaces merge suggestions for conflicting entity names without rewriting", async () => {
      await insertPage("tool/codex", "tool", "Codex");
      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "project/codex",
            name: "Codex",
            type: "project",
            context: "ctx",
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

      const { result: canonicalized, suggestions } =
        await resolver.canonicalizeExtractionResult(result);
      expect(canonicalized.entities[0].slug).toBe("project/codex"); // unchanged
      expect(suggestions).toEqual([
        expect.objectContaining({
          reason: "cross_type_name",
          from_slug: "project/codex",
          into_slug: "tool/codex",
        }),
      ]);
    });

    it("persists suggestions through the injected sink", async () => {
      await insertPage("tool/codex", "tool", "Codex");
      const record = vi.fn().mockResolvedValue(undefined);
      const sinkResolver = new IdentityResolver(db, undefined, { record });

      const result: ExtractionResult = {
        source: mockSource,
        entities: [
          {
            slug: "project/codex",
            name: "Codex",
            type: "project",
            context: "ctx",
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

      await sinkResolver.canonicalizeExtractionResult(result);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "cross_type_name",
          from_slug: "project/codex",
          into_slug: "tool/codex",
        }),
      );
    });
  });
});

// ── Regression: null-guard semantics (commit 7fde24f fix) ────────────────────

describe("IdentityResolver null-guard regressions (7fde24f fix)", () => {
  let database: Database;
  let db: SqlExecutor;

  beforeEach(async () => {
    database = await Database.create();
    db = database.executor;
  });

  afterEach(async () => {
    await database.close();
  });

  describe("resolve() — cache hit with NULL display_name falls through to backend", () => {
    it("calls backend when cache row exists but display_name is NULL", async () => {
      // Seed a NULL-display_name row (permanent-failure marker written by Task 5)
      await db.query(
        "INSERT INTO identity_cache (platform, external_id, display_name, slug_hint) VALUES ($1, $2, $3, $4)",
        ["feishu", "ou_null_test", null, null],
      );

      const mockBackend: IdentityBackend = {
        resolveFeishuOpenId: vi.fn().mockResolvedValue({ name: "王建都", slugHint: "wang-jiandu" }),
      };

      const resolver = new IdentityResolver(db, mockBackend);
      const msgs = [
        {
          platform: "feishu" as const,
          channel: "oc_test",
          contact: "ou_null_test",
          timestamp: "2026-06-13T10:00:00Z",
          content: "hello",
          direction: "received" as const,
          metadata: {},
        },
      ];

      const enriched = await resolver.enrichBatch(msgs);

      // Backend must have been called — cache-hit-with-NULL must NOT short-circuit
      expect(mockBackend.resolveFeishuOpenId).toHaveBeenCalledWith("ou_null_test");

      // Contact should be resolved from backend, not left as the raw id
      expect(enriched[0].contact).toBe("王建都 (wang-jiandu)");
    });

    it("does NOT call backend when cache row has a non-NULL display_name (normal path unchanged)", async () => {
      await db.query(
        "INSERT INTO identity_cache (platform, external_id, display_name, slug_hint) VALUES ($1, $2, $3, $4)",
        ["feishu", "ou_present", "李应龙", "li-yinglong"],
      );

      const mockBackend: IdentityBackend = {
        resolveFeishuOpenId: vi.fn(),
      };

      const resolver = new IdentityResolver(db, mockBackend);
      const msgs = [
        {
          platform: "feishu" as const,
          channel: "oc_test",
          contact: "ou_present",
          timestamp: "2026-06-13T10:00:00Z",
          content: "hello",
          direction: "received" as const,
          metadata: {},
        },
      ];

      const enriched = await resolver.enrichBatch(msgs);

      // Backend must NOT be called — cache hit with real display_name returns early
      expect(mockBackend.resolveFeishuOpenId).not.toHaveBeenCalled();
      expect(enriched[0].contact).toBe("李应龙 (li-yinglong)");
    });
  });

  describe("canonicalizePersonSlug() — cacheByName hit with NULL display_name falls through to pinyin", () => {
    it("falls through to pinyin generation when cacheByName row has NULL display_name", async () => {
      // Seed a NULL-display_name row for the name key — simulates an incomplete/failed cache entry
      await db.query(
        "INSERT INTO identity_cache (platform, external_id, display_name, slug_hint) VALUES ($1, $2, $3, $4)",
        ["canonical", "王建都", null, null],
      );

      const resolver = new IdentityResolver(db);
      const result = await resolver.canonicalizePersonSlug("王建都", "person/wang-jian-du");

      // Must NOT return modelSlug as canonical — that would declare the model-produced slug canonical
      expect(result.slug).not.toBe("person/wang-jian-du");

      // Must produce the pinyin-based canonical slug
      expect(result.slug).toBe("person/wang-jiandu");
    });

    it("does NOT return { slug: modelSlug, isAlias: false } when cacheByName has NULL display_name", async () => {
      // This is the duplicate-person-page-prevention contract:
      // returning modelSlug as canonical here would let a second variant also
      // declare itself canonical, producing duplicate person pages.
      await db.query(
        "INSERT INTO identity_cache (platform, external_id, display_name, slug_hint) VALUES ($1, $2, $3, $4)",
        ["canonical", "张三", null, null],
      );

      const resolver = new IdentityResolver(db);
      const result1 = await resolver.canonicalizePersonSlug("张三", "person/zhang-san-v1");
      const result2 = await resolver.canonicalizePersonSlug("张三", "person/zhang-san-v2");

      // Both variants must resolve to the SAME canonical slug (pinyin-generated)
      expect(result1.slug).toBe(result2.slug);

      // Neither variant should be declared canonical with isAlias: false while
      // the other gets a different value — both should converge on the pinyin slug
      expect(result1.slug).toBe("person/zhang-san");
      expect(result2.slug).toBe("person/zhang-san");
    });
  });
});
