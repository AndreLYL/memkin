/**
 * Pipeline integration tests
 * Uses all mocks: mock collector, mock provider, temp directories
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { CursorStaging } from "../../src/collectors/feishu/cursor-staging.js";
import { type PipelineConfig, type PipelineOpts, runPipeline } from "../../src/core/pipeline.js";
import type { Collector, CursorProvider, FetchOpts, RawMessage } from "../../src/core/types.js";
import { createMockProvider } from "../../src/extractors/providers/mock.js";

/**
 * Mock collector for testing
 */
function createMockCollector(messages: RawMessage[]): Collector {
  return {
    id: "mock-collector",
    name: "Mock Collector",
    description: "Test collector",
    async healthCheck() {
      return { ok: true, message: "Mock collector is ready" };
    },
    async *fetch(opts: FetchOpts): AsyncGenerator<RawMessage> {
      for (const msg of messages) {
        // Apply cursor filtering
        if (opts.cursor && msg.metadata?.cursor) {
          if (msg.metadata.cursor <= opts.cursor) {
            continue;
          }
        }

        // Apply limit
        if (opts.limit !== undefined && opts.limit <= 0) {
          break;
        }

        yield msg;

        if (opts.limit !== undefined) {
          opts.limit--;
        }
      }
    },
  };
}

/**
 * Mock collector that persists structured per-sub-source cursors, mirroring the
 * FeishuCollector contract (stage-only sources; pipeline decides the commit).
 */
function createMockCursorCollector(
  specs: Array<{ sub: string; cursorVal: number; content: string }>,
): { collector: Collector & CursorProvider; state: { restored: Record<string, unknown> | null } } {
  const state = { staging: new CursorStaging(), restored: null as Record<string, unknown> | null };
  const collector: Collector & CursorProvider = {
    id: "mock-feishu",
    name: "Mock Feishu",
    description: "Test cursor provider",
    async healthCheck() {
      return { ok: true, message: "ok" };
    },
    async *fetch(): AsyncGenerator<RawMessage> {
      state.staging = new CursorStaging();
      for (const s of specs) {
        state.staging.stage(s.sub, "key", { last_sync_at: s.cursorVal });
        yield {
          platform: "feishu",
          channel: `c/${s.sub}`,
          contact: "u",
          timestamp: new Date(s.cursorVal).toISOString(),
          content: s.content,
          direction: "sent",
          metadata: { sub_source: s.sub, message_id: `${s.sub}-id` },
        };
      }
    },
    getCommittableCursors() {
      return state.staging.getCommittable();
    },
    commitSource(n: string) {
      state.staging.commitSource(n);
    },
    discardSource(n: string) {
      state.staging.discardSource(n);
    },
    restoreCursors(d: Record<string, unknown>) {
      state.restored = d;
    },
  };
  return { collector, state };
}

describe("Pipeline", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("runPipeline - normal flow with all stages", async () => {
    // Prepare test data
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "We decided to use TypeScript for the backend project",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
      {
        platform: "test",
        channel: "channel1",
        contact: "user2",
        timestamp: "2024-01-01T10:01:00Z",
        content: "Good idea, TypeScript provides better type safety",
        direction: "received",
        metadata: { cursor: "msg2", message_id: "id2" },
      },
    ];

    const collector = createMockCollector(messages);

    // Mock LLM provider - needs two types of responses:
    // 1. SignificanceVerdict for noise filter L2
    // 2. ExtractionResult for signal extractor
    let callCount = 0;
    const mockProvider = createMockProvider(new Map([["", " "]])); // Dummy map
    mockProvider.chat = async (messages) => {
      callCount++;
      const prompt = messages
        .map((m) => m.content)
        .join(" ")
        .toLowerCase();

      // First call is significance filter
      if (prompt.includes("significance") || callCount === 1) {
        return JSON.stringify({
          worth_processing: true,
          confidence: 0.8,
          reason: "Contains decision-making content",
          topics: ["technical", "decision"],
        });
      }

      // Second call is extraction
      return JSON.stringify({
        source: {
          platform: "test",
          channel: "channel1",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: "test-hash",
          quote: "We decided to use TypeScript",
        },
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
        decisions: [
          {
            summary: "Use TypeScript for backend",
            entities: ["typescript"],
            date: "2024-01-01",
            confidence: "direct",
            source: {
              platform: "test",
              channel: "channel1",
              timestamp: "2024-01-01T10:00:00Z",
              raw_hash: "test-hash",
              quote: "We decided to use TypeScript",
            },
          },
        ],
        tasks: [],
        discoveries: [],
        knowledge: [],
      });
    };

    const config: PipelineConfig = {
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

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    // Assertions
    expect(result.fatal).toBeFalsy();
    expect(result.totalMessages).toBe(2);
    expect(result.okBlocks).toBeGreaterThan(0);
    expect(result.failedBlocks).toBe(0);
    expect(result.skippedBlocks).toBe(0);
    expect(result.lastSuccessMessage).toBeDefined();
    expect(result.lastSuccessMessage?.metadata?.cursor).toBe("msg2");
  });

  test("runPipeline - dry-run mode (stop at BlockBuilder)", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Test message",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
    ];

    const collector = createMockCollector(messages);
    const mockProvider = createMockProvider(new Map()); // Should not be called in dry-run

    const config: PipelineConfig = {
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

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: true,
    };

    const result = await runPipeline(config, opts);

    // In dry-run, should stop after BlockBuilder
    expect(result.fatal).toBeFalsy();
    expect(result.totalMessages).toBe(1);
    expect(result.totalBlocks).toBeGreaterThan(0);
    // No extraction or adapter calls in dry-run
    expect(result.okBlocks).toBe(0);
    expect(result.failedBlocks).toBe(0);
  });

  test("runPipeline - single block failure continues processing", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Block 1 message with some content to avoid being dropped",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
      {
        platform: "test",
        channel: "channel1",
        contact: "user2",
        timestamp: "2024-01-01T12:00:00Z", // 2 hours gap - new block
        content: "Block 2 message with enough content and context to pass scoring",
        direction: "sent", // Make it sent to pass interaction scoring
        metadata: { cursor: "msg2", message_id: "id2" },
      },
    ];

    const collector = createMockCollector(messages);

    const mockProvider = createMockProvider(new Map([["", " "]]));
    mockProvider.chat = async (msgs) => {
      const prompt = msgs.map((m) => m.content).join(" ");

      // Block 1 (contains "Block 1") always fails
      if (prompt.includes("Block 1")) {
        throw new Error("Simulated extraction failure");
      }

      // Block 2: extraction succeeds
      return JSON.stringify({
        source: {
          platform: "test",
          channel: "channel1",
          timestamp: "2024-01-01T12:00:00Z",
          raw_hash: "test-hash",
          quote: "Block 2 message",
        },
        entities: [
          {
            slug: "person/test",
            name: "Test Person",
            type: "person",
            context: "Test entity",
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
    };

    const config: PipelineConfig = {
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

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    // First block failed, second succeeded
    expect(result.fatal).toBeFalsy();
    expect(result.failedBlocks).toBe(1);
    expect(result.okBlocks).toBe(1);
    expect(result.totalMessages).toBe(2);
    // Should NOT commit because failedBlocks > 0
  });

  test("runPipeline - fatal error prevents commit", async () => {
    const _messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Test message",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
    ];

    // Collector that throws error
    const faultyCollector: Collector = {
      id: "faulty",
      name: "Faulty",
      description: "Test",
      async healthCheck() {
        return { ok: true, message: "ok" };
      },
      fetch(): AsyncGenerator<RawMessage, void, unknown> {
        throw new Error("Fatal collector error");
      },
    };

    const mockProvider = createMockProvider(new Map());

    const config: PipelineConfig = {
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

    const opts: PipelineOpts = {
      source: faultyCollector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    // Fatal error - nothing should be committed
    expect(result.fatal).toBe(true);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Fatal");
  });

  test("runPipeline - cursor and dedup commit only on success", async () => {
    const messages: RawMessage[] = [
      {
        platform: "test",
        channel: "channel1",
        contact: "user1",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Message 1 with enough content to pass signal scoring filters",
        direction: "sent",
        metadata: { cursor: "msg1", message_id: "id1" },
      },
      {
        platform: "test",
        channel: "channel1",
        contact: "user2",
        timestamp: "2024-01-01T10:01:00Z",
        content: "Message 2 with sufficient context for extraction processing",
        direction: "sent",
        metadata: { cursor: "msg2", message_id: "id2" },
      },
    ];

    const collector = createMockCollector(messages);

    const mockProvider = createMockProvider(new Map([["", " "]]));
    let callCount = 0;
    mockProvider.chat = async (_messages) => {
      callCount++;

      // All extraction calls return non-empty results
      return JSON.stringify({
        source: {
          platform: "test",
          channel: "channel1",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: "test-hash",
          quote: "Message",
        },
        entities: [
          {
            slug: "person/test",
            name: "Test Person",
            type: "person",
            context: "Test entity",
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
    };

    const config: PipelineConfig = {
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

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    // All blocks succeeded
    expect(result.fatal).toBeFalsy();
    expect(result.failedBlocks).toBe(0);
    expect(result.okBlocks).toBeGreaterThan(0);

    // Verify cursor was committed
    expect(result.lastSuccessMessage?.metadata?.cursor).toBe("msg2");

    // Run again with same collector - should skip due to cursor
    const result2 = await runPipeline(config, {
      ...opts,
      source: createMockCollector(messages),
    });

    // Second run should skip all messages (dedup)
    expect(result2.totalMessages).toBe(0);
  });

  test("runPipeline - advances cursor only for sub-sources that fully ingested", async () => {
    // "alpha" extraction fails; "beta" succeeds. They live on different channels
    // so they become separate blocks.
    const { collector } = createMockCursorCollector([
      {
        sub: "alpha",
        cursorVal: 1000,
        content: "FAILBLOCK alpha message with some content to avoid being dropped by scoring",
      },
      {
        sub: "beta",
        cursorVal: 2000,
        content: "Beta message with some content and enough context to pass scoring filters",
      },
    ]);

    const mockProvider = createMockProvider(new Map([["", " "]]));
    mockProvider.chat = async (msgs) => {
      const prompt = msgs.map((m) => m.content).join(" ");
      if (prompt.includes("FAILBLOCK")) {
        throw new Error("Simulated extraction failure");
      }
      return JSON.stringify({
        source: {
          platform: "feishu",
          channel: "c/beta",
          timestamp: new Date(2000).toISOString(),
          raw_hash: "beta-hash",
          quote: "Beta",
        },
        entities: [
          {
            slug: "person/beta",
            name: "Beta Person",
            type: "person",
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
      });
    };

    const config: PipelineConfig = {
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

    const result = await runPipeline(config, {
      source: collector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: false,
    });

    expect(result.failedBlocks).toBe(1);
    expect(result.okBlocks).toBe(1);

    // Persisted cursor must contain beta (ingested) and NOT alpha (failed).
    const raw = await readFile(join(tempDir, "cursors.yaml"), "utf-8");
    const parsed = parseYaml(raw) as Record<string, string>;
    const cursors = JSON.parse(parsed["mock-feishu"]) as Record<string, unknown>;
    expect(cursors).toHaveProperty("beta");
    expect(cursors).not.toHaveProperty("alpha");

    // A fresh run restores the persisted cursor before fetching.
    const second = createMockCursorCollector([
      {
        sub: "beta",
        cursorVal: 3000,
        content: "Beta message with some content and enough context to pass scoring filters",
      },
    ]);
    await runPipeline(config, {
      source: second.collector,
      provider: mockProvider,
      format: "json",
      adapter: "file",
      dryRun: false,
    });
    expect(second.state.restored).toEqual({ beta: { key: { last_sync_at: 2000 } } });
  });
});
