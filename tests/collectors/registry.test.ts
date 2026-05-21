import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCollector,
  getCollector,
  getAllCollectors,
  resetRegistry,
} from '../../src/collectors';
import type { Collector, RawMessage, FetchOpts } from '../../src/core/types';

function fakeCollector(id: string): Collector {
  return {
    id,
    name: `${id} collector`,
    description: `desc for ${id}`,
    async healthCheck() { return { ok: true, message: 'ok' }; },
    async *fetch(_opts: FetchOpts): AsyncGenerator<RawMessage> {},
  };
}

describe('Collector Registry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('should register and retrieve a collector by id', () => {
    const c = fakeCollector('test-source');
    registerCollector(c);
    expect(getCollector('test-source')).toBe(c);
  });

  it('should return undefined for unknown id', () => {
    expect(getCollector('nonexistent')).toBeUndefined();
  });

  it('should return all registered collectors', () => {
    registerCollector(fakeCollector('a'));
    registerCollector(fakeCollector('b'));
    const all = getAllCollectors();
    expect(all).toHaveLength(2);
    expect(all.map(c => c.id)).toContain('a');
    expect(all.map(c => c.id)).toContain('b');
  });
});
