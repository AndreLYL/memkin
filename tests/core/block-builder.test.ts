import { describe, it, expect } from 'vitest';
import { BlockBuilder } from '../../src/core/block-builder';
import type { RawMessage } from '../../src/core/types';

async function* createGenerator(messages: RawMessage[]): AsyncGenerator<RawMessage> {
  for (const msg of messages) {
    yield msg;
  }
}

function createMessage(
  content: string,
  timestamp: string,
  contact: string,
  metadata?: Record<string, unknown>
): RawMessage {
  return {
    platform: 'test-platform',
    channel: 'test-channel',
    contact,
    timestamp,
    content,
    direction: 'received',
    metadata,
  };
}

describe('BlockBuilder', () => {
  it('should yield nothing for empty input', async () => {
    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator([]))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(0);
  });

  it('should create a single block for messages within default gap', async () => {
    const messages = [
      createMessage('Hello', '2024-01-01T10:00:00Z', 'user1'),
      createMessage('Hi there', '2024-01-01T10:05:00Z', 'user2'),
      createMessage('How are you?', '2024-01-01T10:10:00Z', 'user1'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].messages).toHaveLength(3);
    expect(blocks[0].participants).toEqual(['user1', 'user2']);
    expect(blocks[0].start_time).toBe('2024-01-01T10:00:00Z');
    expect(blocks[0].end_time).toBe('2024-01-01T10:10:00Z');
    expect(blocks[0].block_id).toBeTruthy();
    expect(blocks[0].platform).toBe('test-platform');
    expect(blocks[0].channel).toBe('test-channel');
  });

  it('should split blocks on time gap > 30 minutes', async () => {
    const messages = [
      createMessage('First message', '2024-01-01T10:00:00Z', 'user1'),
      createMessage('Second message', '2024-01-01T10:05:00Z', 'user2'),
      // 40 minutes gap
      createMessage('Third message', '2024-01-01T10:45:00Z', 'user1'),
      createMessage('Fourth message', '2024-01-01T10:50:00Z', 'user2'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[0].end_time).toBe('2024-01-01T10:05:00Z');
    expect(blocks[1].messages).toHaveLength(2);
    expect(blocks[1].start_time).toBe('2024-01-01T10:45:00Z');
  });

  it('should split blocks on thread_id change', async () => {
    const messages = [
      createMessage('Thread 1 msg 1', '2024-01-01T10:00:00Z', 'user1', { thread_id: 'thread-1' }),
      createMessage('Thread 1 msg 2', '2024-01-01T10:01:00Z', 'user2', { thread_id: 'thread-1' }),
      createMessage('Thread 2 msg 1', '2024-01-01T10:02:00Z', 'user1', { thread_id: 'thread-2' }),
      createMessage('Thread 2 msg 2', '2024-01-01T10:03:00Z', 'user2', { thread_id: 'thread-2' }),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[0].thread_id).toBe('thread-1');
    expect(blocks[1].messages).toHaveLength(2);
    expect(blocks[1].thread_id).toBe('thread-2');
  });

  it('should split blocks when token count exceeds max_block_tokens', async () => {
    // Create a long message that exceeds 4000 tokens
    // For English: ~3100 words * 1.3 = 4030 tokens
    const longContent = 'word '.repeat(3100);

    const messages = [
      createMessage('Short message', '2024-01-01T10:00:00Z', 'user1'),
      createMessage(longContent, '2024-01-01T10:01:00Z', 'user2'),
      createMessage('Another short message', '2024-01-01T10:02:00Z', 'user1'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    // First block: "Short message" (tokens < 4000)
    // When we try to add long message (4030 tokens), it would exceed, so split
    // Second block: long message alone (4030 tokens)
    // Third block: "Another short message"
    expect(blocks).toHaveLength(3);
    expect(blocks[0].messages).toHaveLength(1);
    expect(blocks[1].messages).toHaveLength(1);
    expect(blocks[2].messages).toHaveLength(1);
  });

  it('should split blocks when message count exceeds max_block_messages', async () => {
    const messages: RawMessage[] = [];
    for (let i = 0; i < 105; i++) {
      messages.push(createMessage(`Message ${i}`, `2024-01-01T10:${String(i).padStart(2, '0')}:00Z`, 'user1'));
    }

    const builder = new BlockBuilder({ max_block_messages: 100 });
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(100);
    expect(blocks[1].messages).toHaveLength(5);
  });

  it('should calculate token count for Chinese text', async () => {
    const messages = [
      createMessage('你好世界这是一个测试', '2024-01-01T10:00:00Z', 'user1'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    // 10 Chinese characters * 1.5 = 15 tokens
    expect(blocks[0].token_count).toBeGreaterThanOrEqual(15);
    expect(blocks[0].token_count).toBeLessThanOrEqual(16);
  });

  it('should calculate token count for English text', async () => {
    const messages = [
      createMessage('Hello world this is a test', '2024-01-01T10:00:00Z', 'user1'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    // 6 words * 1.3 = 7.8 tokens
    expect(blocks[0].token_count).toBeGreaterThan(7);
    expect(blocks[0].token_count).toBeLessThan(9);
  });

  it('should calculate token count for mixed Chinese and English text', async () => {
    const messages = [
      createMessage('Hello 世界 this is 一个测试', '2024-01-01T10:00:00Z', 'user1'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].token_count).toBeGreaterThan(10);
  });

  it('should respect custom configuration', async () => {
    const messages = [
      createMessage('First', '2024-01-01T10:00:00Z', 'user1'),
      createMessage('Second', '2024-01-01T10:02:00Z', 'user2'),
      // 7 minutes gap - should NOT split with default but SHOULD split with 5 min gap
      createMessage('Third', '2024-01-01T10:09:00Z', 'user1'),
    ];

    const builder = new BlockBuilder({ block_gap_minutes: 5 });
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[1].messages).toHaveLength(1);
  });

  it('should deduplicate participants correctly', async () => {
    const messages = [
      createMessage('Message 1', '2024-01-01T10:00:00Z', 'user1'),
      createMessage('Message 2', '2024-01-01T10:01:00Z', 'user2'),
      createMessage('Message 3', '2024-01-01T10:02:00Z', 'user1'),
      createMessage('Message 4', '2024-01-01T10:03:00Z', 'user2'),
      createMessage('Message 5', '2024-01-01T10:04:00Z', 'user3'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].participants.sort()).toEqual(['user1', 'user2', 'user3']);
  });

  it('should handle messages without thread_id', async () => {
    const messages = [
      createMessage('Message without thread', '2024-01-01T10:00:00Z', 'user1'),
      createMessage('Another without thread', '2024-01-01T10:01:00Z', 'user2'),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].thread_id).toBeUndefined();
  });
});
