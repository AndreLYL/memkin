import * as os from "node:os";
import * as path from "node:path";
import type { RawMessage } from "../../core/types.js";
import { AgentSessionCollector } from "./collector.js";
import type { SessionLayout, SessionMeta, SessionParseContext, SessionParser } from "./types.js";

export class ClaudeCodeParser implements SessionParser {
  readonly platformId = "claude-code";

  parseSessionMeta(_line: Record<string, unknown>): SessionMeta | null {
    return null;
  }

  isConversationRecord(line: Record<string, unknown>): boolean {
    return line.type === "user" || line.type === "assistant";
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
    if (typeof content === "string") {
      textContent = content;
    } else if (Array.isArray(content)) {
      textContent = (content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text ?? "")
        .join("\n\n");
      if (!textContent.trim()) return null;
    } else {
      return null;
    }

    return {
      platform: "claude-code",
      channel: sessionId, // Use sessionId from content, not from path
      contact: role === "user" ? "user" : "assistant",
      timestamp,
      content: textContent,
      direction: role === "user" ? "sent" : "received",
      metadata: {
        session_id: sessionId,
        uuid,
        // No `cursor` field: agent incrementality is driven by the agent_sessions ledger,
        // not the legacy pipeline string-cursor (which this omission disables for this source).
        cwd,
      },
    };
  }
}

export function claudeCodeLayout(baseDir?: string): SessionLayout {
  const base = baseDir || path.join(os.homedir(), ".claude", "projects");
  return {
    baseDir: base,
    glob: "*/*.jsonl",
    sessionIdFromPath: (filePath: string) => path.basename(filePath, ".jsonl"),
    channelFromPath: (_filePath: string, sessionId: string) => sessionId,
  };
}

export function createClaudeCodeCollector(baseDir?: string): AgentSessionCollector {
  // Cursor pagination retired (extraction-quality-redesign PR-0). The former fetch wrapper
  // skipped sessions via `sessionId <= cursor` — a lexicographic UUID comparison that only
  // dropped the FIRST message of each "past" session (subsequent turns leaked through) and
  // lost single-message and recovered sessions entirely. Incremental processing is now the
  // job of the agent_sessions ledger (content_hash-keyed revisions) + scan watermark, so the
  // collector just yields every conversation turn from every stable transcript. A stale
  // string cursor may still be read from cursors.yaml for back-compat, but it is ignored.
  return new AgentSessionCollector(claudeCodeLayout(baseDir), new ClaudeCodeParser(), {
    name: "Claude Code Agent",
    description: "Collects conversation history from Claude Code JSONL transcripts",
  });
}
