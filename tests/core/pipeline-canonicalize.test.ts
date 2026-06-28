/**
 * Integration test for pipeline Stage 2.5: Person slug canonicalization.
 *
 * Drives the real `runPipeline` with a mock collector + mock provider and a
 * live store, verifying that when an `identityResolver` is supplied the person
 * slug variants produced by the model are canonicalized and deduplicated
 * before pages are written.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { StoreAdapterContext } from "../../src/adapters/store.js";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import { type PipelineConfig, runPipeline } from "../../src/core/pipeline.js";
import type { Collector, FetchOpts, RawMessage } from "../../src/core/types.js";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

function createMockCollector(messages: RawMessage[]): Collector {
  return {
    id: "mock-collector",
    name: "Mock Collector",
    description: "Test collector",
    async healthCheck() {
      return { ok: true, message: "ok" };
    },
    async *fetch(opts: FetchOpts): AsyncGenerator<RawMessage> {
      for (const msg of messages) {
        if (opts.cursor && msg.metadata?.cursor && msg.metadata.cursor <= opts.cursor) {
          continue;
        }
        yield msg;
      }
    },
  };
}

function baseConfig(tempDir: string): PipelineConfig {
  return {
    dedup_checkpoint: join(tempDir, "dedup.jsonl"),
    cursor_checkpoint: join(tempDir, "cursors.yaml"),
    block_gap_minutes: 30,
    max_block_tokens: 4000,
    max_block_messages: 100,
    privacy: {
      enabled: false,
      mode: "irreversible",
      redact_phone: false,
      redact_id_card: false,
      redact_bank_card: false,
      blocked_words: [],
      replacement: "[REDACTED]",
    },
    output_dir: join(tempDir, "output"),
  };
}

describe("Pipeline Stage 2.5: Person Canonicalization (runPipeline wiring)", () => {
  let tempDir: string;
  let db: Database;
  let stores: StoreAdapterContext;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-canon-"));
    db = await Database.create();
    stores = {
      pages: new PageStore(db.executor),
      chunks: new ChunkStore(db.executor),
      graph: new GraphStore(db.executor),
      tags: new TagStore(db.executor),
      timeline: new TimelineStore(db.executor),
    };
  });

  afterEach(async () => {
    await db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("canonicalizes and dedupes person slugs through runPipeline when identityResolver is set", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "王建都 and Sylar are leading the project with enough context to pass scoring",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
      {
        platform: "test",
        channel: "channel1",
        contact: "user2",
        timestamp: "2024-01-01T10:01:00Z",
        content: "王建都 owns the implementation task and Sylar reviews it for the team",
        direction: "sent",
        metadata: { cursor: "msg2", message_id: "id2" },
      },
    ];

    const source = {
      platform: "test",
      channel: "channel1",
      timestamp: "2024-01-01T10:00:00Z",
      raw_hash: "test-hash",
      quote: "王建都 and Sylar",
    };

    const mockProvider = createMockProvider(new Map([["", " "]]));
    mockProvider.chat = async () =>
      JSON.stringify({
        source,
        entities: [
          // Two model-produced slug variants for the same person.
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "project lead",
            confidence: "direct",
          },
          {
            slug: "person/wang-jiandu",
            name: "王建都",
            type: "person",
            context: "owns task",
            confidence: "paraphrased",
          },
          {
            slug: "person/sylar",
            name: "Sylar",
            type: "person",
            context: "reviewer",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [
          {
            title: "Implement feature",
            status: "open",
            owner: "person/wang-jian-du",
            confidence: "direct",
            source,
          },
        ],
        discoveries: [],
        knowledge: [],
      });

    const result = await runPipeline(baseConfig(tempDir), {
      source: createMockCollector(messages),
      provider: mockProvider,
      format: "json",
      adapter: "store",
      stores,
      identityResolver: new IdentityResolver(db.executor),
      dryRun: false,
    });

    expect(result.fatal).toBeFalsy();
    expect(result.okBlocks).toBeGreaterThan(0);
    // Canonicalization is best-effort; it must not produce warnings here.
    expect(
      result.warnings.filter((w) => w.includes("Person canonicalization failed")),
    ).toHaveLength(0);

    // Only the canonical person page exists; the variant slug is folded into it.
    const canonical = await stores.pages.getPage("person/wang-jiandu");
    expect(canonical).not.toBeNull();
    expect(canonical?.frontmatter.aliases).toContain("person/wang-jian-du");

    const variant = await stores.pages.getPage("person/wang-jian-du");
    expect(variant).toBeNull();

    // Latin name is untouched.
    const sylar = await stores.pages.getPage("person/sylar");
    expect(sylar).not.toBeNull();
  });

  test("leaves slugs untouched when no identityResolver is supplied", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "王建都 is working on the project with sufficient context to pass scoring",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
    ];

    const source = {
      platform: "test",
      channel: "channel1",
      timestamp: "2024-01-01T10:00:00Z",
      raw_hash: "test-hash-2",
      quote: "王建都",
    };

    const mockProvider = createMockProvider(new Map([["", " "]]));
    mockProvider.chat = async () =>
      JSON.stringify({
        source,
        entities: [
          {
            slug: "person/wang-jian-du",
            name: "王建都",
            type: "person",
            context: "project work",
            confidence: "direct",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      });

    const result = await runPipeline(baseConfig(tempDir), {
      source: createMockCollector(messages),
      provider: mockProvider,
      format: "json",
      adapter: "store",
      stores,
      // No identityResolver: Stage 2.5 must be skipped entirely.
      dryRun: false,
    });

    expect(result.fatal).toBeFalsy();
    expect(result.okBlocks).toBeGreaterThan(0);

    // The raw model slug is kept as-is.
    const page = await stores.pages.getPage("person/wang-jian-du");
    expect(page).not.toBeNull();
    expect(page?.frontmatter.aliases).toBeUndefined();
  });
});
