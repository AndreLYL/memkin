import * as os from "node:os";
import * as path from "node:path";
import type { RawMessage } from "../../core/types.js";
import { AgentSessionCollector } from "./collector.js";
import type { SessionLayout, SessionMeta, SessionParseContext, SessionParser } from "./types.js";

const SYSTEM_TAG_PREFIXES = [
  "<environment_context",
  "<permissions",
  "<collaboration_mode",
  "<skills_instructions",
];

export class CodexParser implements SessionParser {
  readonly platformId = "codex";
  private seenUserTexts = new Set<string>();

  parseSessionMeta(line: Record<string, unknown>): SessionMeta | null {
    if (line.type !== "session_meta") return null;
    const payload = line.payload as Record<string, unknown>;
    return {
      sessionId: payload.id as string,
      timestamp: line.timestamp as string,
      cwd: payload.cwd as string | undefined,
    };
  }

  isConversationRecord(line: Record<string, unknown>): boolean {
    if (line.type === "response_item") {
      const payload = line.payload as Record<string, unknown>;
      const role = payload.role as string;
      return role === "user" || role === "assistant";
    }
    if (line.type === "event_msg") {
      const payload = line.payload as Record<string, unknown>;
      return payload.type === "user_message";
    }
    return false;
  }

  parseRecord(line: Record<string, unknown>, context: SessionParseContext): RawMessage | null {
    const timestamp = line.timestamp as string;

    if (line.type === "event_msg") {
      return this.parseEventMsg(line, context, timestamp);
    }

    const payload = line.payload as Record<string, unknown>;
    const role = payload.role as string;
    const content = payload.content as Array<{ type: string; text?: string }>;

    if (role === "user") {
      return this.parseUserRecord(content, context, timestamp);
    }

    if (role === "assistant") {
      return this.parseAssistantRecord(content, context, timestamp);
    }

    return null;
  }

  private parseUserRecord(
    content: Array<{ type: string; text?: string }>,
    context: SessionParseContext,
    timestamp: string,
  ): RawMessage | null {
    const text = content
      .filter((c) => (c.type === "input_text" || c.type === "text") && c.text)
      .map((c) => c.text ?? "")
      .join("\n\n");

    if (!text.trim()) return null;

    const trimmed = text.trim();
    if (SYSTEM_TAG_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
      return null;
    }

    const dedupKey = trimmed.slice(0, 200).toLowerCase();
    if (this.seenUserTexts.has(dedupKey)) return null;
    this.seenUserTexts.add(dedupKey);

    return {
      platform: "codex",
      channel: context.channel,
      contact: "user",
      timestamp,
      content: text,
      direction: "sent",
      metadata: {
        session_id: context.sessionId,
        cursor: context.sessionId,
        record_type: "response_item",
      },
    };
  }

  private parseAssistantRecord(
    content: Array<{ type: string; text?: string }>,
    context: SessionParseContext,
    timestamp: string,
  ): RawMessage | null {
    const text = content
      .filter((c) => c.type === "output_text" && c.text)
      .map((c) => c.text ?? "")
      .join("\n\n");

    if (!text.trim()) return null;

    return {
      platform: "codex",
      channel: context.channel,
      contact: "assistant",
      timestamp,
      content: text,
      direction: "received",
      metadata: {
        session_id: context.sessionId,
        cursor: context.sessionId,
        record_type: "response_item",
      },
    };
  }

  private parseEventMsg(
    line: Record<string, unknown>,
    context: SessionParseContext,
    timestamp: string,
  ): RawMessage | null {
    const payload = line.payload as Record<string, unknown>;
    if (payload.type !== "user_message") return null;

    const text = payload.message as string;
    if (!text?.trim()) return null;

    const dedupKey = text.trim().slice(0, 200).toLowerCase();
    if (this.seenUserTexts.has(dedupKey)) return null;
    this.seenUserTexts.add(dedupKey);

    return {
      platform: "codex",
      channel: context.channel,
      contact: "user",
      timestamp,
      content: text,
      direction: "sent",
      metadata: {
        session_id: context.sessionId,
        cursor: context.sessionId,
        record_type: "event_msg",
      },
    };
  }
}

export function codexLayout(baseDir?: string): SessionLayout {
  const base = baseDir || path.join(os.homedir(), ".codex");
  return {
    baseDir: base,
    glob: "sessions/**/*.jsonl",
    sessionIdFromPath: (filePath: string) => {
      const basename = path.basename(filePath, ".jsonl");
      const parts = basename.split("-");
      if (parts.length >= 5) {
        return parts.slice(-5).join("-");
      }
      return basename;
    },
    channelFromPath: (_filePath: string, sessionId: string) => sessionId,
  };
}

export function createCodexCollector(baseDir?: string): AgentSessionCollector {
  return new AgentSessionCollector(codexLayout(baseDir), new CodexParser(), {
    name: "Codex CLI Agent",
    description: "Collects session rollouts from Codex CLI",
  });
}
