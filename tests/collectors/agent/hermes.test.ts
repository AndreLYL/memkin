import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { HermesParser, createHermesCollector } from '../../../src/collectors/agent/hermes';
import type { SessionParseContext } from '../../../src/collectors/agent/types';
import type { RawMessage } from '../../../src/core/types';

describe('HermesParser', () => {
  const parser = new HermesParser();
  const baseContext: SessionParseContext = {
    sessionId: 'test',
    filePath: '/agents/main/sessions/test.jsonl',
    channel: 'main/test',
    lineIndex: 0,
    sessionMeta: null,
  };

  it('should have platformId "hermes"', () => {
    expect(parser.platformId).toBe('hermes');
  });

  it('should parse session meta', () => {
    const line = { type: 'session', id: 'h-001', version: '1.0', timestamp: '2024-02-01T14:00:00Z', cwd: '/project' };
    const meta = parser.parseSessionMeta(line);
    expect(meta).toEqual({ sessionId: 'h-001', timestamp: '2024-02-01T14:00:00Z', cwd: '/project' });
  });

  it('should identify message with user role as conversation record', () => {
    const line = { type: 'message', message: { role: 'user', content: [] } };
    expect(parser.isConversationRecord(line)).toBe(true);
  });

  it('should identify message with assistant role as conversation record', () => {
    const line = { type: 'message', message: { role: 'assistant', content: [] } };
    expect(parser.isConversationRecord(line)).toBe(true);
  });

  it('should NOT identify model_change as conversation record', () => {
    const line = { type: 'model_change', model: 'claude-sonnet' };
    expect(parser.isConversationRecord(line)).toBe(false);
  });

  it('should NOT identify thinking_level_change as conversation record', () => {
    const line = { type: 'thinking_level_change', level: 'high' };
    expect(parser.isConversationRecord(line)).toBe(false);
  });

  it('should NOT identify custom events as conversation record', () => {
    const line = { type: 'custom', name: 'model-snapshot', data: {} };
    expect(parser.isConversationRecord(line)).toBe(false);
  });

  it('should parse user message extracting only text content', () => {
    const line = {
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'Research AI agents' }] },
      timestamp: '2024-02-01T14:00:01Z',
    };
    const msg = parser.parseRecord(line, baseContext);
    expect(msg).not.toBeNull();
    expect(msg!.contact).toBe('user');
    expect(msg!.content).toBe('Research AI agents');
    expect(msg!.direction).toBe('sent');
    expect(msg!.platform).toBe('hermes');
    expect(msg!.channel).toBe('main/test');
  });

  it('should parse assistant message, extract text only, skip thinking/toolCall/toolResult', () => {
    const line = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me think...' },
          { type: 'text', text: 'Here are the trends.' },
          { type: 'toolCall', name: 'search', input: {} },
          { type: 'toolResult', name: 'search', result: '...' },
        ],
      },
      timestamp: '2024-02-01T14:00:05Z',
    };
    const msg = parser.parseRecord(line, baseContext);
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe('Here are the trends.');
    expect(msg!.content).not.toContain('think');
    expect(msg!.content).not.toContain('search');
  });

  it('should extract agent_name from filePath', () => {
    const ctx: SessionParseContext = {
      ...baseContext,
      filePath: '/home/user/.openclaw/agents/researcher/sessions/abc.jsonl',
    };
    const line = {
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      timestamp: '2024-02-01T14:00:00Z',
    };
    const msg = parser.parseRecord(line, ctx);
    expect(msg!.metadata?.agent_name).toBe('researcher');
  });

  it('should return null for assistant message with no text content', () => {
    const line = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', name: 'read', input: { path: '/file' } },
          { type: 'toolResult', name: 'read', result: 'file content' },
        ],
      },
      timestamp: '2024-02-01T14:00:05Z',
    };
    const msg = parser.parseRecord(line, baseContext);
    expect(msg).toBeNull();
  });
});

describe('createHermesCollector integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should collect messages from fixture file', async () => {
    const agentDir = path.join(tempDir, 'main', 'sessions');
    await fs.mkdir(agentDir, { recursive: true });

    const fixturePath = path.join(__dirname, '../../fixtures/hermes-session/main/sessions/session-001.jsonl');
    const targetPath = path.join(agentDir, 'session-001.jsonl');
    await fs.copyFile(fixturePath, targetPath);

    const collector = createHermesCollector(tempDir);
    const messages: RawMessage[] = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    // 2 user + 2 assistant (text only) = 4
    expect(messages.length).toBe(4);

    const users = messages.filter(m => m.contact === 'user');
    const assistants = messages.filter(m => m.contact === 'assistant');
    expect(users).toHaveLength(2);
    expect(assistants).toHaveLength(2);

    expect(messages[0].channel).toContain('main/');
  });

  it('should exclude .trajectory.jsonl files', async () => {
    const agentDir = path.join(tempDir, 'coder', 'sessions');
    await fs.mkdir(agentDir, { recursive: true });

    await fs.writeFile(
      path.join(agentDir, 'session-001.trajectory.jsonl'),
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"should not appear"}]},"timestamp":"2024-02-01T14:00:00Z"}\n',
    );

    await fs.writeFile(
      path.join(agentDir, 'session-002.jsonl'),
      '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"should appear"}]},"timestamp":"2024-02-01T14:00:00Z"}\n',
    );

    const collector = createHermesCollector(tempDir);
    const messages: RawMessage[] = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('should appear');
  });
});
