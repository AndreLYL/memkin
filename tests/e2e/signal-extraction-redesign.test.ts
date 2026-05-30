/**
 * E2E Tests for Redesigned Signal Extraction Pipeline
 *
 * Tests the complete redesigned pipeline flow:
 * 1. L1 filter (keyword-based) → skip/escalate/null
 * 2. Canonicalize (source-aware cleaning)
 * 3. ScoreBlock (5-dim cheap scoring)
 * 4. Score gate (mapScoreDecision) → skip/pass
 * 5. LLM extraction (only for pass/escalate)
 * 6. Empty extraction guard
 */

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type PipelineConfig, type PipelineOpts, runPipeline } from "../../src/core/pipeline.js";
import type { Collector, ExtractionResult, FetchOpts, RawMessage } from "../../src/core/types.js";
import type { ChatMessage, LLMProvider } from "../../src/extractors/providers/types.js";

/**
 * Create a valid extraction result with at least one non-empty signal array
 */
function createValidExtraction(content: string): ExtractionResult {
  const quote = content.substring(0, 250);
  const rawHash = crypto.createHash("sha256").update(content).digest("hex");

  return {
    source: {
      platform: "test-platform",
      channel: "test-channel",
      timestamp: "2024-01-01T10:00:00Z",
      message_id: "msg-001",
      raw_hash: rawHash,
      quote: quote,
    },
    entities: [
      {
        slug: "people/alice",
        name: "Alice",
        type: "person",
        context: "Tech lead for the project",
        confidence: "direct",
      },
    ],
    timeline: [
      {
        date: "2024-01-01",
        summary: "Project decision made",
        entities: ["people/alice"],
        source: {
          platform: "test-platform",
          channel: "test-channel",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: rawHash,
          quote: quote.substring(0, 100),
        },
        confidence: "direct",
      },
    ],
    links: [],
    decisions: [
      {
        summary: "Use microservices architecture",
        reasoning: "Better scalability",
        entities: ["people/alice"],
        date: "2024-01-01",
        confidence: "direct",
        source: {
          platform: "test-platform",
          channel: "test-channel",
          timestamp: "2024-01-01T10:00:00Z",
          raw_hash: rawHash,
          quote: quote.substring(0, 150),
        },
      },
    ],
    tasks: [],
    discoveries: [],
    knowledge: [],
  };
}

/**
 * Create an empty extraction (all arrays empty)
 */
function createEmptyExtraction(content: string): ExtractionResult {
  const quote = content.substring(0, 250);
  const rawHash = crypto.createHash("sha256").update(content).digest("hex");

  return {
    source: {
      platform: "test-platform",
      channel: "test-channel",
      timestamp: "2024-01-01T10:00:00Z",
      message_id: "msg-001",
      raw_hash: rawHash,
      quote: quote,
    },
    entities: [],
    timeline: [],
    links: [],
    decisions: [],
    tasks: [],
    discoveries: [],
    knowledge: [],
  };
}

/**
 * Create a mock collector from a list of messages
 */
function createMockCollector(messages: RawMessage[]): Collector {
  return {
    id: "test-collector",
    name: "Test Collector",
    description: "Mock collector for E2E testing",
    async healthCheck() {
      return { ok: true, message: "Mock collector ready" };
    },
    async *fetch(_opts: FetchOpts): AsyncGenerator<RawMessage> {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

describe("Signal Extraction Redesign E2E Tests", () => {
  let tempDir: string;
  let config: PipelineConfig;
  let llmCallCount: number;

  /**
   * Create a mock provider that counts calls and returns valid extractions
   */
  function createCountingMockProvider(extractionResult: ExtractionResult | "empty"): LLMProvider {
    return {
      async chat(_messages: ChatMessage[]): Promise<string> {
        llmCallCount++;
        const result = extractionResult === "empty"
          ? createEmptyExtraction("mock content")
          : extractionResult;
        return JSON.stringify(result);
      },
    };
  }

  beforeEach(async () => {
    llmCallCount = 0;
    tempDir = await mkdtemp(join(tmpdir(), "memoark-redesign-e2e-"));
    config = {
      dedup_checkpoint: join(tempDir, "dedup.jsonl"),
      cursor_checkpoint: join(tempDir, "cursors.yaml"),
      block_gap_minutes: 10,
      max_block_tokens: 4000,
      max_block_messages: 50,
      privacy: {
        enabled: false,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      },
      output_dir: join(tempDir, "output"),
    };
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("a. Email with substance → admit → extraction produces signals", async () => {
    const messages: RawMessage[] = [
      {
        platform: "email",
        channel: "mail/INBOX",
        contact: "alice@example.com",
        timestamp: "2024-01-01T10:00:00Z",
        content: "We have decided to use JWT for authentication. This will improve security and scalability. Alice will be the tech lead and Bob will handle implementation. Deadline is next Friday.",
        direction: "sent",
        metadata: { cursor: "1", message_id: "email-001" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider(createValidExtraction("email content"));

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(result.okBlocks).toBe(1);
    expect(result.skippedBlocks).toBe(0);
    expect(llmCallCount).toBe(1);
  });

  test("b. System notification → L1 skip → no LLM call", async () => {
    const messages: RawMessage[] = [
      {
        platform: "wechat",
        channel: "group/oc_abc123",
        contact: "system",
        timestamp: "2024-01-01T10:00:00Z",
        content: "张三 加入群聊",
        direction: "received",
        metadata: { cursor: "1", message_id: "msg-001" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider(createValidExtraction("system notification"));

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(result.skippedBlocks).toBe(1);
    expect(result.okBlocks).toBe(0);
    expect(llmCallCount).toBe(0);
  });

  test("c. Short empty chat with no interaction → score drop → no LLM call", async () => {
    const messages: RawMessage[] = [
      {
        platform: "wechat",
        channel: "group/oc_def456",
        contact: "bob",
        timestamp: "2024-01-01T10:00:00Z",
        content: "OK",
        direction: "received",
        metadata: { cursor: "1", message_id: "msg-001" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider(createValidExtraction("ok message"));

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(result.skippedBlocks).toBe(1);
    expect(result.okBlocks).toBe(0);
    expect(llmCallCount).toBe(0);
  });

  test("d. Chat with escalate keyword → bypass score gate → always extracted", async () => {
    const messages: RawMessage[] = [
      {
        platform: "wechat",
        channel: "group/oc_ghi789",
        contact: "alice",
        timestamp: "2024-01-01T10:00:00Z",
        content: "OK 我们决定了",
        direction: "sent",
        metadata: { cursor: "1", message_id: "msg-001" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider(createValidExtraction("decision keyword"));

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(result.okBlocks).toBe(1);
    expect(result.skippedBlocks).toBe(0);
    expect(llmCallCount).toBe(1);
  });

  test("e. LLM returns empty extraction → treated as skipped", async () => {
    const messages: RawMessage[] = [
      {
        platform: "wechat",
        channel: "group/oc_jkl012",
        contact: "charlie",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Let me think about the architecture design for the new microservices platform. We need to consider scalability, security, and maintainability carefully.",
        direction: "sent",
        metadata: { cursor: "1", message_id: "msg-001" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider("empty");

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(llmCallCount).toBe(1);
    expect(result.okBlocks).toBe(0);
    expect(result.skippedBlocks).toBe(1);
  });

  test("f. LLM call count matches only blocks reaching extraction", async () => {
    const messages: RawMessage[] = [
      // Message 1: L1 skip (system notification)
      {
        platform: "wechat",
        channel: "group/oc_abc",
        contact: "system",
        timestamp: "2024-01-01T10:00:00Z",
        content: "李四 退出群聊",
        direction: "received",
        metadata: { cursor: "1", message_id: "msg-001" },
      },
      // Message 2: Email with substance → admit → LLM
      {
        platform: "email",
        channel: "mail/INBOX",
        contact: "alice@example.com",
        timestamp: "2024-01-01T10:05:00Z",
        content: "We have decided to migrate to cloud infrastructure. This is a strategic decision for better scalability and cost efficiency. Alice will lead the migration project starting next quarter.",
        direction: "sent",
        metadata: { cursor: "2", message_id: "email-001" },
      },
      // Message 3: Emoji-only L1 skip
      {
        platform: "wechat",
        channel: "group/oc_def",
        contact: "bob",
        timestamp: "2024-01-01T10:10:00Z",
        content: "👍",
        direction: "received",
        metadata: { cursor: "3", message_id: "msg-002" },
      },
      // Message 4: Escalate keyword → LLM
      {
        platform: "wechat",
        channel: "group/oc_ghi",
        contact: "charlie",
        timestamp: "2024-01-01T10:15:00Z",
        content: "我们决定下周上线新版本，大家准备一下",
        direction: "sent",
        metadata: { cursor: "4", message_id: "msg-003" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider(createValidExtraction("multi-message test"));

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(llmCallCount).toBe(2);
    expect(result.okBlocks).toBe(2);
    expect(result.skippedBlocks).toBe(2);
  });

  test("g. Chat regression — multi-message block still extracted", async () => {
    // 3 messages to same channel within time gap (will form 1 block)
    const messages: RawMessage[] = [
      {
        platform: "wechat",
        channel: "group/oc_xyz",
        contact: "alice",
        timestamp: "2024-01-01T10:00:00Z",
        content: "Let's discuss the new architecture",
        direction: "sent",
        metadata: { cursor: "1", message_id: "msg-001" },
      },
      {
        platform: "wechat",
        channel: "group/oc_xyz",
        contact: "bob",
        timestamp: "2024-01-01T10:02:00Z",
        content: "I think we should use microservices approach",
        direction: "received",
        metadata: { cursor: "2", message_id: "msg-002" },
      },
      {
        platform: "wechat",
        channel: "group/oc_xyz",
        contact: "alice",
        timestamp: "2024-01-01T10:04:00Z",
        content: "Agreed. I will document the design decisions and share with the team by end of week.",
        direction: "sent",
        metadata: { cursor: "3", message_id: "msg-003" },
      },
    ];

    const collector = createMockCollector(messages);
    const provider = createCountingMockProvider(createValidExtraction("architecture discussion"));

    const opts: PipelineOpts = {
      source: collector,
      provider: provider,
      format: "json",
      adapter: "stdout",
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    expect(result.fatal).toBe(false);
    expect(llmCallCount).toBe(1);
    expect(result.okBlocks).toBe(1);
    expect(result.skippedBlocks).toBe(0);
  });
});
