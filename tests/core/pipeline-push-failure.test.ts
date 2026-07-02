/**
 * Regression test for AUDIT issue #1 (CRITICAL): adapter push failure must not
 * permanently mark source messages as processed.
 *
 * Bug: Stage 4 pushed extraction results and merged per-signal write failures
 * into `warnings` only. Stage 5 committed the dedup checkpoint whenever
 * `failedBlocks === 0`, which is never incremented on adapter push failures.
 * So a store write that throws (DB error, disk full, constraint violation) for
 * a successfully-extracted block still committed the source messages' dedup
 * hashes — on the next run `dedup.check()` returned "unchanged" and those
 * messages were skipped forever, permanently losing the signals.
 *
 * Fix: gate the dedup + cursor commit on `pushResult.errors.length === 0` as
 * well. Re-extracting already-persisted messages is safe (store writes are
 * idempotent upserts keyed on source_hash), whereas dropping unpersisted
 * signals is not recoverable.
 *
 * This drives the REAL runPipeline with a live store; we force a real store
 * write to throw so a real PushResult.error is produced, then assert the dedup
 * checkpoint was NOT committed and the second run re-processes the message.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { StoreAdapterContext } from "../../src/adapters/store.js";
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

const SOURCE = {
  platform: "test",
  channel: "channel1",
  timestamp: "2024-01-01T10:00:00Z",
  raw_hash: "test-hash",
  quote: "We decided to use TypeScript",
};

function successfulExtractionProvider() {
  const provider = createMockProvider(new Map([["", " "]]));
  provider.chat = async () =>
    JSON.stringify({
      source: SOURCE,
      entities: [
        {
          slug: "typescript",
          name: "TypeScript",
          type: "tool",
          context: "Programming language",
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
  return provider;
}

describe("Pipeline: adapter push failure must not commit dedup (AUDIT #1)", () => {
  let tempDir: string;
  let db: Database;
  let stores: StoreAdapterContext;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-push-fail-"));
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

  test("push error does not commit dedup, and the message is re-processed next run", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "We decided to use TypeScript with enough context to pass signal scoring",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
    ];

    // Force the real store write to fail for this run, producing a genuine
    // PushResult.error (not a mocked one). The extraction itself succeeds.
    const originalPutPage = stores.pages.putPage.bind(stores.pages);
    let failWrites = true;
    stores.pages.putPage = (async (...args: Parameters<typeof originalPutPage>) => {
      if (failWrites) {
        throw new Error("Simulated store write failure (disk full)");
      }
      return originalPutPage(...args);
    }) as typeof stores.pages.putPage;

    const result = await runPipeline(baseConfig(tempDir), {
      source: createMockCollector(messages),
      provider: successfulExtractionProvider(),
      format: "json",
      adapter: "store",
      stores,
      dryRun: false,
    });

    // Extraction succeeded, but the store write failed → recorded as a warning.
    expect(result.fatal).toBeFalsy();
    expect(result.okBlocks).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("Adapter error"))).toBe(true);

    // Dedup checkpoint must NOT have been committed for the failed message.
    // If it were committed, the second run would skip it forever.
    const { DedupStore } = await import("../../src/core/dedup.js");
    const dedupAfterRun1 = new DedupStore(baseConfig(tempDir).dedup_checkpoint);
    dedupAfterRun1.load();
    expect(dedupAfterRun1.check(messages[0])).toBe("new");

    // Second run: writes now succeed. The message MUST be re-collected and
    // re-extracted (not skipped as "unchanged"), and the signal persisted.
    failWrites = false;
    const result2 = await runPipeline(baseConfig(tempDir), {
      source: createMockCollector(messages),
      provider: successfulExtractionProvider(),
      format: "json",
      adapter: "store",
      stores,
      dryRun: false,
    });

    expect(result2.fatal).toBeFalsy();
    // The message was re-collected (not skipped by dedup) and processed.
    expect(result2.totalMessages).toBe(1);
    expect(result2.skippedMessages).toHaveLength(0);
    expect(result2.okBlocks).toBeGreaterThan(0);
    expect(result2.warnings.some((w) => w.includes("Adapter error"))).toBe(false);

    // The signal that was lost on run 1 is now persisted.
    const page = await stores.pages.getPage("typescript");
    expect(page).not.toBeNull();

    // And now the dedup is committed, so a third run would correctly skip it.
    const dedupAfterRun2 = new DedupStore(baseConfig(tempDir).dedup_checkpoint);
    dedupAfterRun2.load();
    expect(dedupAfterRun2.check(messages[0])).toBe("unchanged");
  });
});
