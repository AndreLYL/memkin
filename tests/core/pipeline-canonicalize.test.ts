/**
 * Integration test for pipeline Stage 2.5: Person slug canonicalization
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import { runSimplePipeline } from "../../src/core/pipeline.js";
import type {
  Adapter,
  AdapterPushResult,
  ConversationBlock,
  ExtractionResult,
  RawMessage,
} from "../../src/core/types.js";

const SCHEMA_PATH = resolve(__dirname, "../../src/store/schema.sql");

describe("Pipeline Stage 2.5: Person Canonicalization", () => {
  let db: PGlite;
  let resolver: IdentityResolver;
  let capturedResults: ExtractionResult[] = [];

  // Mock adapter that captures extraction results
  class TestAdapter implements Adapter {
    id = "test-adapter";
    name = "Test Adapter";
    description = "Captures extraction results for testing";

    async healthCheck() {
      return { ok: true, message: "OK" };
    }

    async push(results: ExtractionResult[]): Promise<AdapterPushResult> {
      capturedResults = [...results];
      return { written: results.length, skipped: 0, errors: [] };
    }
  }

  beforeEach(async () => {
    db = new PGlite({ extensions: { vector } });
    const schema = readFileSync(SCHEMA_PATH, "utf-8");
    await db.exec(schema);
    resolver = new IdentityResolver(db);
    capturedResults = [];
  });

  afterEach(async () => {
    await db.close();
  });

  it("should canonicalize person slugs and attach aliases to ExtractionResult", async () => {
    // Create a conversation block with multiple person entities
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "test-channel",
        contact: "tester",
        timestamp: "2024-01-01T10:00:00Z",
        content: "王建都 and Sylar are working on the project together.",
        direction: "received",
      },
    ];

    const block: ConversationBlock = {
      block_id: "test-block-1",
      platform: "test",
      channel: "test-channel",
      messages,
      start_time: "2024-01-01T10:00:00Z",
      end_time: "2024-01-01T10:00:00Z",
      participants: ["tester"],
      token_count: 50,
    };

    // Mock extractor that returns entities with different slug variants
    const mockExtractor = {
      extract: async (): Promise<ExtractionResult> => ({
        source: {
          platform: "test",
          channel: "test-channel",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: "test-hash",
          quote: "test quote",
        },
        entities: [
          {
            slug: "person/wang-jian-du", // Model-generated variant
            name: "王建都",
            type: "person",
            context: "working on project",
            confidence: "direct",
          },
          {
            slug: "person/wang-jiandu", // Another variant
            name: "王建都",
            type: "person",
            context: "collaborating",
            confidence: "paraphrased",
          },
          {
            slug: "person/sylar",
            name: "Sylar",
            type: "person",
            context: "team member",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [
          {
            from: "person/wang-jian-du",
            to: "project/test-project",
            type: "works_on",
            context: "working on",
            confidence: "direct",
            source: {
              platform: "test",
              channel: "test-channel",
              timestamp: "2024-01-01T10:00:00Z",
              raw_hash: "test-hash",
              quote: "test quote",
            },
          },
        ],
        decisions: [],
        tasks: [
          {
            title: "Complete feature",
            status: "open",
            owner: "person/wang-jian-du",
            confidence: "direct",
            source: {
              platform: "test",
              channel: "test-channel",
              timestamp: "2024-01-01T10:00:00Z",
              raw_hash: "test-hash",
              quote: "test quote",
            },
          },
        ],
        discoveries: [],
        knowledge: [],
      }),
    };

    const adapter = new TestAdapter();

    // Run pipeline with identity resolver
    const result = await runSimplePipeline({
      blocks: [block],
      extractor: mockExtractor,
      adapter,
      identityResolver: resolver,
    });

    // Verify pipeline completed successfully
    expect(result.status).toBe("success");
    expect(result.warnings).toEqual([]);

    // Verify extraction results were captured
    expect(capturedResults).toHaveLength(1);
    const extractionResult = capturedResults[0];

    // Verify person entities were canonicalized and merged
    expect(extractionResult.entities.filter((e) => e.type === "person")).toHaveLength(2);

    // Find Wang Jiandu entity
    const wangEntity = extractionResult.entities.find((e) => e.slug === "person/wang-jiandu");
    expect(wangEntity).toBeDefined();
    expect(wangEntity?.name).toBe("王建都");

    // Sylar should remain unchanged
    const sylarEntity = extractionResult.entities.find((e) => e.slug === "person/sylar");
    expect(sylarEntity).toBeDefined();
    expect(sylarEntity?.name).toBe("Sylar");

    // Verify person slugs were rewritten in links
    expect(extractionResult.links[0].from).toBe("person/wang-jiandu");

    // Verify person slugs were rewritten in tasks
    expect(extractionResult.tasks[0].owner).toBe("person/wang-jiandu");

    // Verify personAliases was populated
    expect(extractionResult.personAliases).toBeDefined();
    expect(extractionResult.personAliases?.["person/wang-jiandu"]).toContain("person/wang-jian-du");
  });

  it("should handle extraction with no person entities gracefully", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "test-channel",
        contact: "tester",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Project update: deployment successful.",
        direction: "received",
      },
    ];

    const block: ConversationBlock = {
      block_id: "test-block-2",
      platform: "test",
      channel: "test-channel",
      messages,
      start_time: "2024-01-01T10:00:00Z",
      end_time: "2024-01-01T10:00:00Z",
      participants: ["tester"],
      token_count: 30,
    };

    // Mock extractor that returns only non-person entities
    const mockExtractor = {
      extract: async (): Promise<ExtractionResult> => ({
        source: {
          platform: "test",
          channel: "test-channel",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: "test-hash-2",
          quote: "test quote 2",
        },
        entities: [
          {
            slug: "project/test-project",
            name: "Test Project",
            type: "project",
            context: "deployment successful",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      }),
    };

    const adapter = new TestAdapter();

    // Run pipeline with identity resolver
    const result = await runSimplePipeline({
      blocks: [block],
      extractor: mockExtractor,
      adapter,
      identityResolver: resolver,
    });

    // Verify pipeline completed successfully
    expect(result.status).toBe("success");
    expect(result.warnings).toEqual([]);

    // Verify extraction results
    expect(capturedResults).toHaveLength(1);
    const extractionResult = capturedResults[0];

    // Verify non-person entities remain unchanged
    expect(extractionResult.entities).toHaveLength(1);
    expect(extractionResult.entities[0].slug).toBe("project/test-project");

    // personAliases should still be set (empty map)
    expect(extractionResult.personAliases).toBeDefined();
    expect(Object.keys(extractionResult.personAliases || {})).toHaveLength(0);
  });

  it("should continue with original slugs if canonicalization fails", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "test-channel",
        contact: "tester",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Test message",
        direction: "received",
      },
    ];

    const block: ConversationBlock = {
      block_id: "test-block-3",
      platform: "test",
      channel: "test-channel",
      messages,
      start_time: "2024-01-01T10:00:00Z",
      end_time: "2024-01-01T10:00:00Z",
      participants: ["tester"],
      token_count: 30,
    };

    const mockExtractor = {
      extract: async (): Promise<ExtractionResult> => ({
        source: {
          platform: "test",
          channel: "test-channel",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: "test-hash-3",
          quote: "test quote 3",
        },
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "test",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      }),
    };

    const adapter = new TestAdapter();

    // Create a separate DB and resolver that will be closed before pipeline runs
    const failingDb = new PGlite({ extensions: { vector } });
    const schema = readFileSync(SCHEMA_PATH, "utf-8");
    await failingDb.exec(schema);
    const failingResolver = new IdentityResolver(failingDb);

    // Close the DB immediately to make resolver fail
    await failingDb.close();

    // Run pipeline with failing resolver
    const result = await runSimplePipeline({
      blocks: [block],
      extractor: mockExtractor,
      adapter,
      identityResolver: failingResolver,
    });

    // Pipeline should complete with a warning
    expect(result.status).toBe("success");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("Person canonicalization failed");

    // Verify original slugs were preserved
    expect(capturedResults).toHaveLength(1);
    const extractionResult = capturedResults[0];
    expect(extractionResult.entities[0].slug).toBe("person/wang-jian-du");
  });
});
