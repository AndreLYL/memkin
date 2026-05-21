import * as path from 'node:path';
import * as os from 'node:os';
import type { RawMessage } from '../../core/types';
import type { SessionParser, SessionLayout, SessionMeta, SessionParseContext } from './types';
import { AgentSessionCollector } from './collector';

export class ClaudeCodeParser implements SessionParser {
  readonly platformId = 'claude-code';

  parseSessionMeta(_line: Record<string, unknown>): SessionMeta | null {
    return null;
  }

  isConversationRecord(line: Record<string, unknown>): boolean {
    return line.type === 'user' || line.type === 'assistant';
  }

  parseRecord(line: Record<string, unknown>, context: SessionParseContext): RawMessage | null {
    const message = line.message as { role: string; content: unknown } | undefined;
    const uuid = line.uuid as string | undefined;
    const timestamp = line.timestamp as string | undefined;
    const cwd = line.cwd as string | undefined;
    const sessionId = (line.sessionId as string) || context.sessionId;

    if (!message || !timestamp || !uuid) return null;

    const { role, content } = message;

    let textContent: string;
    if (typeof content === 'string') {
      textContent = content;
    } else if (Array.isArray(content)) {
      textContent = (content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text!)
        .join('\n\n');
      if (!textContent.trim()) return null;
    } else {
      return null;
    }

    return {
      platform: 'claude-code',
      channel: sessionId, // Use sessionId from content, not from path
      contact: role === 'user' ? 'user' : 'assistant',
      timestamp,
      content: textContent,
      direction: role === 'user' ? 'sent' : 'received',
      metadata: {
        session_id: sessionId,
        uuid,
        cursor: sessionId,
        cwd,
      },
    };
  }
}

export function claudeCodeLayout(baseDir?: string): SessionLayout {
  const base = baseDir || path.join(os.homedir(), '.claude', 'projects');
  return {
    baseDir: base,
    glob: '*/*.jsonl',
    sessionIdFromPath: (filePath: string) => path.basename(filePath, '.jsonl'),
    channelFromPath: (_filePath: string, sessionId: string) => sessionId,
  };
}

export function createClaudeCodeCollector(baseDir?: string): AgentSessionCollector {
  const baseCollector = new AgentSessionCollector(
    claudeCodeLayout(baseDir),
    new ClaudeCodeParser(),
    {
      name: 'Claude Code Agent',
      description: 'Collects conversation history from Claude Code JSONL transcripts',
    },
  );

  // Wrap fetch to add cursor-based pagination
  const originalFetch = baseCollector.fetch.bind(baseCollector);
  baseCollector.fetch = async function* (opts) {
    const cursor = opts.cursor;
    const seenSessions = new Set<string>();

    for await (const message of originalFetch(opts)) {
      const sessionId = message.metadata?.session_id as string;

      if (!sessionId) {
        yield message;
        continue;
      }

      // If we've already started yielding this session, continue yielding
      if (seenSessions.has(sessionId)) {
        yield message;
        continue;
      }

      // If cursor is set and this session should be skipped, skip ALL messages from this session
      if (cursor && sessionId <= cursor) {
        seenSessions.add(sessionId);
        continue;
      }

      // First message from this session and it passes cursor check
      seenSessions.add(sessionId);
      yield message;
    }
  };

  return baseCollector;
}
