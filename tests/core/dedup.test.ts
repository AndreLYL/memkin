/**
 * Tests for DedupStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DedupStore } from '../../src/core/dedup';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { RawMessage } from '../../src/core/types';

const TEST_DIR = resolve(__dirname, '.test-data');
const CHECKPOINT_PATH = resolve(TEST_DIR, 'test-checkpoint.jsonl');

describe('DedupStore', () => {
  let store: DedupStore;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    if (existsSync(CHECKPOINT_PATH)) {
      unlinkSync(CHECKPOINT_PATH);
    }
    store = new DedupStore(CHECKPOINT_PATH);
    store.load();
  });

  afterEach(() => {
    if (existsSync(CHECKPOINT_PATH)) {
      unlinkSync(CHECKPOINT_PATH);
    }
  });

  it('should return "new" for previously unseen message', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { message_id: 'msg-123' },
    };

    expect(store.check(msg)).toBe('new');
  });

  it('should return "unchanged" for same source and content', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { message_id: 'msg-123' },
    };

    store.commit([msg]);
    expect(store.check(msg)).toBe('unchanged');
  });

  it('should return "modified" for same source but different content', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { message_id: 'msg-123' },
    };

    store.commit([msg]);

    const modified: RawMessage = {
      ...msg,
      content: 'Hello, world!', // Content changed
    };

    expect(store.check(modified)).toBe('modified');
  });

  it('should persist and reload checkpoint', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { message_id: 'msg-123' },
    };

    store.commit([msg]);

    // Create new store instance and load
    const store2 = new DedupStore(CHECKPOINT_PATH);
    store2.load();

    expect(store2.check(msg)).toBe('unchanged');
  });

  it('should handle empty commit gracefully', () => {
    store.commit([]);
    expect(existsSync(CHECKPOINT_PATH)).toBe(false);
  });

  it('should use message_id as primary identity key', () => {
    const msg1: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { message_id: 'msg-123', uuid: 'uuid-456' },
    };

    const msg2: RawMessage = {
      ...msg1,
      metadata: { message_id: 'msg-123', uuid: 'uuid-different' },
    };

    // Same message_id → same source hash
    expect(store.sourceIdentityHash(msg1)).toBe(store.sourceIdentityHash(msg2));
  });

  it('should fall back to uuid if message_id missing', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { uuid: 'uuid-456' },
    };

    const hash = store.sourceIdentityHash(msg);
    expect(hash).toBeTruthy();
  });

  it('should fall back to thread_id if message_id and uuid missing', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { thread_id: 'thread-789' },
    };

    const hash = store.sourceIdentityHash(msg);
    expect(hash).toBeTruthy();
  });

  it('should use session_id:index if only session_id present', () => {
    const msg1: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { session_id: 'session-abc', index: 0 },
    };

    const msg2: RawMessage = {
      ...msg1,
      metadata: { session_id: 'session-abc', index: 1 },
    };

    // Different indices → different source hashes
    expect(store.sourceIdentityHash(msg1)).not.toBe(store.sourceIdentityHash(msg2));
  });

  it('should use session_id:0 if index missing', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { session_id: 'session-abc' },
    };

    const hash = store.sourceIdentityHash(msg);
    expect(hash).toBeTruthy();
  });

  it('should fall back to timestamp:index as last resort', () => {
    const msg1: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
      metadata: { index: 0 },
    };

    const msg2: RawMessage = {
      ...msg1,
      metadata: { index: 1 },
    };

    // Different indices → different source hashes
    expect(store.sourceIdentityHash(msg1)).not.toBe(store.sourceIdentityHash(msg2));
  });

  it('should use timestamp:0 if no metadata at all', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      direction: 'received',
    };

    const hash = store.sourceIdentityHash(msg);
    expect(hash).toBeTruthy();
  });

  it('should include attachments in content hash', () => {
    const msg1: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Check this out',
      direction: 'received',
      metadata: { message_id: 'msg-123' },
      attachments: [{ id: 'att-1', type: 'image' }],
    };

    const msg2: RawMessage = {
      ...msg1,
      attachments: [{ id: 'att-2', type: 'image' }],
    };

    store.commit([msg1]);

    // Different attachment → modified
    expect(store.check(msg2)).toBe('modified');
  });

  it('should handle multiple attachments in content hash', () => {
    const msg: RawMessage = {
      platform: 'wechat',
      channel: 'friend:alice',
      contact: 'alice',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Check these',
      direction: 'received',
      metadata: { message_id: 'msg-123' },
      attachments: [
        { id: 'att-1', type: 'image' },
        { id: 'att-2', type: 'video' },
      ],
    };

    const hash = store.contentHash(msg);
    expect(hash).toBeTruthy();

    // Verify content hash includes attachment order
    const reordered: RawMessage = {
      ...msg,
      attachments: [
        { id: 'att-2', type: 'video' },
        { id: 'att-1', type: 'image' },
      ],
    };

    expect(store.contentHash(reordered)).not.toBe(hash);
  });
});
