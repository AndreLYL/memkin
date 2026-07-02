/**
 * Regression test for AUDIT A6: the persisted per-source cursor checkpoint must
 * be restored into a CursorProvider collector BEFORE fetch on a subsequent run.
 *
 * Bug: the write path worked — Stage 5 called `getCommittableCursors()` and
 * persisted the per-source map via `cursorStore.setJSON(source.id, ...)`. But
 * the read path (pipeline Stage 1) only read the LEGACY string cursor
 * (`cursorStore.get(source.id)`) and passed it in FetchOpts, which a
 * CursorProvider collector like FeishuCollector ignores. The structured
 * checkpoint was never injected back, so every run started from a null
 * checkpoint → full re-fetch each time.
 *
 * Fix: near the cursor read, detect CursorProvider (same duck-type guard used
 * at commit time), read `cursorStore.getJSON(source.id)`, and inject it via the
 * optional `setCheckpoint` method before fetch.
 *
 * This drives the REAL runPipeline with a live store. Run 1 stages a structured
 * cursor which the pipeline persists; run 2 uses a fresh collector instance and
 * asserts the exact checkpoint reaches `setCheckpoint` before fetch. It also
 * proves the legacy string-cursor path is untouched.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { StoreAdapterContext } from "../../src/adapters/store.js";
import { type PipelineConfig, runPipeline } from "../../src/core/pipeline.js";
import type { Collector, CursorProvider, FetchOpts, RawMessage } from "../../src/core/types.js";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

/**
 * A fake collector that behaves like FeishuCollector: it stages a structured
 * per-source cursor (getCommittableCursors) and restores one via setCheckpoint.
 * It records every checkpoint it receives so the test can assert what the
 * pipeline injected before fetch.
 */
class FakeCursorCollector implements Collector, CursorProvider {
  readonly id = "fake-feishu";
  readonly name = "Fake Feishu";
  readonly description = "Fake CursorProvider collector for restore test";

  /** Checkpoint received via setCheckpoint (null until injected). */
  receivedCheckpoint: Record<string, unknown> | null = null;
  /** The cursor value we observed for the calendar source during fetch. */
  observedSyncToken: string | undefined;

  constructor(
    private readonly messages: RawMessage[],
    /** What we will stage as the committable cursor for this run. */
    private readonly stagedCursors: Record<string, unknown>,
  ) {}

  setCheckpoint(checkpoint: Record<string, unknown> | null): void {
    this.receivedCheckpoint = checkpoint;
  }

  async healthCheck() {
    return { ok: true, message: "ok" };
  }

  async *fetch(_opts: FetchOpts): AsyncGenerator<RawMessage> {
    // Mirror FeishuCollector: read the per-source slice from the injected
    // checkpoint, exactly as a real source would.
    const calendarSlice = this.receivedCheckpoint?.calendar as
      | Record<string, { sync_token?: string }>
      | undefined;
    this.observedSyncToken = calendarSlice?.cal1?.sync_token;

    for (const msg of this.messages) {
      yield msg;
    }
  }

  getCommittableCursors(): Record<string, unknown> {
    return this.stagedCursors;
  }

  discardSource(_sourceName: string): void {
    // no-op for the test
  }
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
  platform: "feishu",
  channel: "calendar/cal1",
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

function calendarMessage(cursorSuffix: string): RawMessage {
  return {
    platform: "feishu",
    channel: "calendar/cal1",
    contact: "user1",
    timestamp: "2024-01-01T10:00:00Z",
    content: "We decided to use TypeScript with enough context to pass signal scoring gate",
    direction: "sent",
    metadata: { message_id: `id-${cursorSuffix}` },
  };
}

describe("Pipeline: restore persisted per-source cursor before fetch (A6)", () => {
  let tempDir: string;
  let db: Database;
  let stores: StoreAdapterContext;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-cursor-restore-"));
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

  test("run 2's collector receives the checkpoint persisted by run 1", async () => {
    const stagedCursors = {
      calendar: { cal1: { sync_token: "sync-token-v2" } },
    };

    // Run 1: stages a structured cursor, which the pipeline persists on success.
    const collector1 = new FakeCursorCollector([calendarMessage("run1")], stagedCursors);
    const result1 = await runPipeline(baseConfig(tempDir), {
      source: collector1,
      provider: successfulExtractionProvider(),
      format: "json",
      adapter: "store",
      stores,
      dryRun: false,
    });

    expect(result1.fatal).toBeFalsy();
    expect(result1.okBlocks).toBeGreaterThan(0);
    // Run 1 had no persisted cursor yet → nothing injected.
    expect(collector1.receivedCheckpoint).toBeNull();
    expect(collector1.observedSyncToken).toBeUndefined();

    // The pipeline should have persisted the staged cursor to disk.
    const { CursorStore } = await import("../../src/core/cursors.js");
    const store = new CursorStore(baseConfig(tempDir).cursor_checkpoint);
    store.load();
    expect(store.getJSON("fake-feishu")).toEqual(stagedCursors);

    // Run 2: a FRESH collector instance (no in-memory checkpoint). The pipeline
    // must read the persisted cursor and inject it before fetch.
    const collector2 = new FakeCursorCollector([calendarMessage("run2")], {
      calendar: { cal1: { sync_token: "sync-token-v3" } },
    });
    const result2 = await runPipeline(baseConfig(tempDir), {
      source: collector2,
      provider: successfulExtractionProvider(),
      format: "json",
      adapter: "store",
      stores,
      dryRun: false,
    });

    expect(result2.fatal).toBeFalsy();
    // The persisted checkpoint reached the collector via setCheckpoint...
    expect(collector2.receivedCheckpoint).toEqual(stagedCursors);
    // ...and was actually visible to the source at fetch time.
    expect(collector2.observedSyncToken).toBe("sync-token-v2");
  });

  test("legacy string-cursor collector is unaffected (no setCheckpoint)", async () => {
    // A collector with no CursorProvider surface and no setCheckpoint. It reads
    // the legacy string cursor from FetchOpts. The restore path must be a no-op
    // for it and must not throw.
    const seenCursors: (string | undefined)[] = [];
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "We decided to use TypeScript with enough context to pass scoring",
        direction: "sent",
        metadata: { cursor: "msg-1", message_id: "legacy-1" },
      },
    ];
    const legacyCollector: Collector = {
      id: "legacy-collector",
      name: "Legacy",
      description: "String cursor collector",
      async healthCheck() {
        return { ok: true, message: "ok" };
      },
      async *fetch(opts: FetchOpts) {
        seenCursors.push(opts.cursor);
        for (const msg of messages) yield msg;
      },
    };

    const result1 = await runPipeline(baseConfig(tempDir), {
      source: legacyCollector,
      provider: successfulExtractionProvider(),
      format: "json",
      adapter: "store",
      stores,
      dryRun: false,
    });
    expect(result1.fatal).toBeFalsy();
    // Run 1: no persisted cursor → undefined.
    expect(seenCursors[0]).toBeUndefined();

    // Run 1 committed the legacy string cursor from metadata.cursor.
    const { CursorStore } = await import("../../src/core/cursors.js");
    const store = new CursorStore(baseConfig(tempDir).cursor_checkpoint);
    store.load();
    expect(store.get("legacy-collector")).toBe("msg-1");

    const result2 = await runPipeline(baseConfig(tempDir), {
      source: legacyCollector,
      provider: successfulExtractionProvider(),
      format: "json",
      adapter: "store",
      stores,
      dryRun: false,
    });
    expect(result2.fatal).toBeFalsy();
    // Run 2: the legacy string cursor was passed via FetchOpts, unchanged.
    expect(seenCursors[1]).toBe("msg-1");
  });
});
