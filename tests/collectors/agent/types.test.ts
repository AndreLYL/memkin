import { describe, it, expectTypeOf } from 'vitest';
import type {
  SessionParser,
  SessionLayout,
  SessionMeta,
  SessionParseContext,
} from '../../../src/collectors/agent/types';
import type { RawMessage } from '../../../src/core/types';

describe('Collector agent types', () => {
  it('SessionParser interface has correct shape', () => {
    expectTypeOf<SessionParser>().toHaveProperty('platformId');
    expectTypeOf<SessionParser>().toHaveProperty('parseSessionMeta');
    expectTypeOf<SessionParser>().toHaveProperty('isConversationRecord');
    expectTypeOf<SessionParser>().toHaveProperty('parseRecord');
  });

  it('SessionParseContext has required fields', () => {
    const ctx: SessionParseContext = {
      sessionId: 'test',
      filePath: '/test/file.jsonl',
      channel: 'test-channel',
      lineIndex: 0,
      sessionMeta: null,
    };
    expectTypeOf(ctx.sessionMeta).toEqualTypeOf<SessionMeta | null>();
  });

  it('SessionLayout has required fields', () => {
    expectTypeOf<SessionLayout>().toHaveProperty('baseDir');
    expectTypeOf<SessionLayout>().toHaveProperty('glob');
    expectTypeOf<SessionLayout>().toHaveProperty('sessionIdFromPath');
    expectTypeOf<SessionLayout>().toHaveProperty('channelFromPath');
  });
});
