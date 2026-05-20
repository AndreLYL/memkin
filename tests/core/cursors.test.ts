/**
 * Tests for CursorStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CursorStore } from '../../src/core/cursors';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const TEST_DIR = resolve(__dirname, '.test-data');
const CURSOR_PATH = resolve(TEST_DIR, 'test-cursors.yaml');

describe('CursorStore', () => {
  let store: CursorStore;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    if (existsSync(CURSOR_PATH)) {
      unlinkSync(CURSOR_PATH);
    }
    store = new CursorStore(CURSOR_PATH);
    store.load();
  });

  afterEach(() => {
    if (existsSync(CURSOR_PATH)) {
      unlinkSync(CURSOR_PATH);
    }
  });

  it('should return undefined for unknown collector', () => {
    expect(store.get('unknown-collector')).toBeUndefined();
  });

  it('should return set value after set()', () => {
    store.set('wechat-collector', 'cursor-123');
    expect(store.get('wechat-collector')).toBe('cursor-123');
  });

  it('should persist and reload cursors', () => {
    store.set('wechat-collector', 'cursor-123');
    store.commit();

    // Create new store instance and load
    const store2 = new CursorStore(CURSOR_PATH);
    store2.load();

    expect(store2.get('wechat-collector')).toBe('cursor-123');
  });

  it('should not write file if not dirty', () => {
    store.commit();
    expect(existsSync(CURSOR_PATH)).toBe(false);
  });

  it('should handle multiple collectors independently', () => {
    store.set('wechat-collector', 'cursor-wechat-123');
    store.set('telegram-collector', 'cursor-telegram-456');
    store.commit();

    const store2 = new CursorStore(CURSOR_PATH);
    store2.load();

    expect(store2.get('wechat-collector')).toBe('cursor-wechat-123');
    expect(store2.get('telegram-collector')).toBe('cursor-telegram-456');
  });

  it('should update existing cursor', () => {
    store.set('wechat-collector', 'cursor-old');
    store.commit();

    store.set('wechat-collector', 'cursor-new');
    store.commit();

    const store2 = new CursorStore(CURSOR_PATH);
    store2.load();

    expect(store2.get('wechat-collector')).toBe('cursor-new');
  });

  it('should not commit if set() not called', () => {
    store.load();
    store.commit();
    expect(existsSync(CURSOR_PATH)).toBe(false);
  });

  it('should mark dirty after set() and clean after commit()', () => {
    store.set('wechat-collector', 'cursor-123');
    store.commit();

    // Second commit without set should not write
    const mtimeBefore = existsSync(CURSOR_PATH)
      ? require('fs').statSync(CURSOR_PATH).mtimeMs
      : null;

    store.commit();

    const mtimeAfter = existsSync(CURSOR_PATH)
      ? require('fs').statSync(CURSOR_PATH).mtimeMs
      : null;

    expect(mtimeBefore).toBe(mtimeAfter);
  });

  it('should handle empty YAML file gracefully', () => {
    require('fs').writeFileSync(CURSOR_PATH, '', 'utf-8');

    const store2 = new CursorStore(CURSOR_PATH);
    store2.load();

    expect(store2.get('any-collector')).toBeUndefined();
  });

  it('should handle malformed YAML gracefully', () => {
    require('fs').writeFileSync(
      CURSOR_PATH,
      'invalid: yaml: content:',
      'utf-8'
    );

    const store2 = new CursorStore(CURSOR_PATH);
    // Should not throw
    expect(() => store2.load()).not.toThrow();
  });

  it('should preserve cursors after load() + set() + commit()', () => {
    store.set('collector-a', 'cursor-a');
    store.commit();

    const store2 = new CursorStore(CURSOR_PATH);
    store2.load();
    store2.set('collector-b', 'cursor-b');
    store2.commit();

    const store3 = new CursorStore(CURSOR_PATH);
    store3.load();

    expect(store3.get('collector-a')).toBe('cursor-a');
    expect(store3.get('collector-b')).toBe('cursor-b');
  });
});
