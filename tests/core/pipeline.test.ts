/**
 * Pipeline integration tests
 * Uses all mocks: mock collector, mock provider, temp directories
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline, PipelineConfig, PipelineOpts } from '../../src/core/pipeline.js';
import type { Collector, RawMessage, FetchOpts } from '../../src/core/types.js';
import { createMockProvider } from '../../src/extractors/providers/mock.js';

/**
 * Mock collector for testing
 */
function createMockCollector(messages: RawMessage[]): Collector {
  return {
    id: 'mock-collector',
    name: 'Mock Collector',
    description: 'Test collector',
    async healthCheck() {
      return { ok: true, message: 'Mock collector is ready' };
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

describe('Pipeline', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pipeline-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('runPipeline - normal flow with all stages', async () => {
    // Prepare test data
    const messages: RawMessage[] = [
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user1',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'We decided to use TypeScript for the backend project',
        direction: 'sent',
        metadata: { cursor: 'msg1', message_id: 'id1' },
      },
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user2',
        timestamp: '2024-01-01T10:01:00Z',
        content: 'Good idea, TypeScript provides better type safety',
        direction: 'received',
        metadata: { cursor: 'msg2', message_id: 'id2' },
      },
    ];

    const collector = createMockCollector(messages);

    // Mock LLM provider - needs two types of responses:
    // 1. SignificanceVerdict for noise filter L2
    // 2. ExtractionResult for signal extractor
    let callCount = 0;
    const mockProvider = createMockProvider(new Map([['',' ']])); // Dummy map
    mockProvider.chat = async (messages) => {
      callCount++;
      const prompt = messages.map((m) => m.content).join(' ').toLowerCase();

      // First call is significance filter
      if (prompt.includes('significance') || callCount === 1) {
        return JSON.stringify({
          worth_processing: true,
          confidence: 0.8,
          reason: 'Contains decision-making content',
          topics: ['technical', 'decision'],
        });
      }

      // Second call is extraction
      return JSON.stringify({
        source: {
          platform: 'test',
          channel: 'channel1',
          timestamp: '2024-01-01T10:00:00Z',
          raw_hash: 'test-hash',
          quote: 'We decided to use TypeScript',
        },
        entities: [
          {
            slug: 'typescript',
            name: 'TypeScript',
            type: 'tool',
            context: 'Programming language',
            confidence: 'direct',
          },
        ],
        timeline: [],
        links: [],
        decisions: [
          {
            summary: 'Use TypeScript for backend',
            entities: ['typescript'],
            date: '2024-01-01',
            confidence: 'direct',
            source: {
              platform: 'test',
              channel: 'channel1',
              timestamp: '2024-01-01T10:00:00Z',
              raw_hash: 'test-hash',
              quote: 'We decided to use TypeScript',
            },
          },
        ],
        tasks: [],
        discoveries: [],
      });
    };

    const config: PipelineConfig = {
      dedup_checkpoint: join(tempDir, 'dedup.jsonl'),
      cursor_checkpoint: join(tempDir, 'cursors.yaml'),
      block_gap_minutes: 30,
      max_block_tokens: 4000,
      max_block_messages: 100,
      privacy: {
        enabled: false,
        mode: 'irreversible',
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        blocked_words: [],
        replacement: '[REDACTED]',
      },
      output_dir: join(tempDir, 'output'),
    };

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: 'json',
      adapter: 'file',
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
    expect(result.lastSuccessMessage?.metadata?.cursor).toBe('msg2');
  });

  test('runPipeline - dry-run mode (stop at BlockBuilder)', async () => {
    const messages: RawMessage[] = [
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user1',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Test message',
        direction: 'sent',
        metadata: { cursor: 'msg1', message_id: 'id1' },
      },
    ];

    const collector = createMockCollector(messages);
    const mockProvider = createMockProvider(new Map()); // Should not be called in dry-run

    const config: PipelineConfig = {
      dedup_checkpoint: join(tempDir, 'dedup.jsonl'),
      cursor_checkpoint: join(tempDir, 'cursors.yaml'),
      block_gap_minutes: 30,
      max_block_tokens: 4000,
      max_block_messages: 100,
      privacy: {
        enabled: false,
        mode: 'irreversible',
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        blocked_words: [],
        replacement: '[REDACTED]',
      },
      output_dir: join(tempDir, 'output'),
    };

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: 'json',
      adapter: 'file',
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

  test('runPipeline - single block failure continues processing', async () => {
    const messages: RawMessage[] = [
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user1',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Block 1 message',
        direction: 'sent',
        metadata: { cursor: 'msg1', message_id: 'id1' },
      },
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user2',
        timestamp: '2024-01-01T12:00:00Z', // 2 hours gap - new block
        content: 'Block 2 message',
        direction: 'received',
        metadata: { cursor: 'msg2', message_id: 'id2' },
      },
    ];

    const collector = createMockCollector(messages);

    let callCount = 0;
    // First block: fail on extraction only (pass significance, fail extraction)
    // Second block: success on both
    const mockProvider = createMockProvider(new Map([['',' ']]));
    mockProvider.chat = async (messages) => {
      callCount++;
      const prompt = messages.map((m) => m.content).join(' ').toLowerCase();

      const isSignificanceCall = prompt.includes('significance');

      // First block: significance passes (call 1), extraction fails (call 2)
      if (callCount === 1) {
        // Significance for block 1
        return JSON.stringify({
          worth_processing: true,
          confidence: 0.8,
          reason: 'Contains content',
          topics: ['general'],
        });
      }
      if (callCount === 2) {
        // Extraction for block 1 - FAIL
        throw new Error('Simulated extraction failure');
      }

      // Second block: both calls succeed
      if (isSignificanceCall || (callCount === 3)) {
        return JSON.stringify({
          worth_processing: true,
          confidence: 0.8,
          reason: 'Contains content',
          topics: ['general'],
        });
      }

      return JSON.stringify({
        source: {
          platform: 'test',
          channel: 'channel1',
          timestamp: '2024-01-01T12:00:00Z',
          raw_hash: 'test-hash',
          quote: 'Block 2 message',
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
      });
    };

    const config: PipelineConfig = {
      dedup_checkpoint: join(tempDir, 'dedup.jsonl'),
      cursor_checkpoint: join(tempDir, 'cursors.yaml'),
      block_gap_minutes: 30,
      max_block_tokens: 4000,
      max_block_messages: 100,
      privacy: {
        enabled: false,
        mode: 'irreversible',
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        blocked_words: [],
        replacement: '[REDACTED]',
      },
      output_dir: join(tempDir, 'output'),
    };

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: 'json',
      adapter: 'file',
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

  test('runPipeline - fatal error prevents commit', async () => {
    const messages: RawMessage[] = [
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user1',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Test message',
        direction: 'sent',
        metadata: { cursor: 'msg1', message_id: 'id1' },
      },
    ];

    // Collector that throws error
    const faultyCollector: Collector = {
      id: 'faulty',
      name: 'Faulty',
      description: 'Test',
      async healthCheck() {
        return { ok: true, message: 'ok' };
      },
      async *fetch() {
        throw new Error('Fatal collector error');
      },
    };

    const mockProvider = createMockProvider(new Map());

    const config: PipelineConfig = {
      dedup_checkpoint: join(tempDir, 'dedup.jsonl'),
      cursor_checkpoint: join(tempDir, 'cursors.yaml'),
      block_gap_minutes: 30,
      max_block_tokens: 4000,
      max_block_messages: 100,
      privacy: {
        enabled: false,
        mode: 'irreversible',
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        blocked_words: [],
        replacement: '[REDACTED]',
      },
      output_dir: join(tempDir, 'output'),
    };

    const opts: PipelineOpts = {
      source: faultyCollector,
      provider: mockProvider,
      format: 'json',
      adapter: 'file',
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    // Fatal error - nothing should be committed
    expect(result.fatal).toBe(true);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Fatal');
  });

  test('runPipeline - cursor and dedup commit only on success', async () => {
    const messages: RawMessage[] = [
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user1',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Message 1',
        direction: 'sent',
        metadata: { cursor: 'msg1', message_id: 'id1' },
      },
      {
        platform: 'test',
        channel: 'channel1',
        contact: 'user2',
        timestamp: '2024-01-01T10:01:00Z',
        content: 'Message 2',
        direction: 'received',
        metadata: { cursor: 'msg2', message_id: 'id2' },
      },
    ];

    const collector = createMockCollector(messages);

    const mockProvider = createMockProvider(new Map([['',' ']]));
    let callCount = 0;
    mockProvider.chat = async (messages) => {
      callCount++;
      const prompt = messages.map((m) => m.content).join(' ').toLowerCase();

      if (prompt.includes('significance') || (callCount % 2 === 1)) {
        return JSON.stringify({
          worth_processing: true,
          confidence: 0.8,
          reason: 'Contains content',
          topics: ['general'],
        });
      }

      return JSON.stringify({
        source: {
          platform: 'test',
          channel: 'channel1',
          timestamp: '2024-01-01T10:00:00Z',
          raw_hash: 'test-hash',
          quote: 'Message',
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
      });
    };

    const config: PipelineConfig = {
      dedup_checkpoint: join(tempDir, 'dedup.jsonl'),
      cursor_checkpoint: join(tempDir, 'cursors.yaml'),
      block_gap_minutes: 30,
      max_block_tokens: 4000,
      max_block_messages: 100,
      privacy: {
        enabled: false,
        mode: 'irreversible',
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        blocked_words: [],
        replacement: '[REDACTED]',
      },
      output_dir: join(tempDir, 'output'),
    };

    const opts: PipelineOpts = {
      source: collector,
      provider: mockProvider,
      format: 'json',
      adapter: 'file',
      dryRun: false,
    };

    const result = await runPipeline(config, opts);

    // All blocks succeeded
    expect(result.fatal).toBeFalsy();
    expect(result.failedBlocks).toBe(0);
    expect(result.okBlocks).toBeGreaterThan(0);

    // Verify cursor was committed
    expect(result.lastSuccessMessage?.metadata?.cursor).toBe('msg2');

    // Run again with same collector - should skip due to cursor
    const result2 = await runPipeline(config, {
      ...opts,
      source: createMockCollector(messages),
    });

    // Second run should skip all messages (dedup)
    expect(result2.totalMessages).toBe(0);
  });
});
