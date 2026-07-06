import * as os from "node:os";
import * as path from "node:path";
import type { RawMessage } from "../../core/types.js";
import { AgentSessionCollector } from "./collector.js";
import type { SessionLayout, SessionMeta, SessionParseContext, SessionParser } from "./types.js";

export class HermesParser implements SessionParser {
  readonly platformId = "hermes";

  parseSessionMeta(line: Record<string, unknown>): SessionMeta | null {
    if (line.type !== "session") return null;
    return {
      sessionId: line.id as string,
      timestamp: line.timestamp as string,
      cwd: line.cwd as string | undefined,
    };
  }

  isConversationRecord(line: Record<string, unknown>): boolean {
    if (line.type !== "message") return false;
    const message = line.message as Record<string, unknown> | undefined;
    if (!message) return false;
    const role = message.role as string;
    return role === "user" || role === "assistant";
  }

  parseRecord(line: Record<string, unknown>, context: SessionParseContext): RawMessage | null {
    const message = line.message as {
      role: string;
      content: Array<{ type: string; text?: string }>;
    };
    const timestamp = line.timestamp as string;

    const textParts = message.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text ?? "");

    const text = textParts.join("\n\n");
    if (!text.trim()) return null;

    const agentName = this.extractAgentName(context.filePath);

    return {
      platform: "hermes",
      channel: context.channel,
      contact: message.role === "user" ? "user" : "assistant",
      timestamp,
      content: text,
      direction: message.role === "user" ? "sent" : "received",
      metadata: {
        session_id: context.sessionId,
        // cursor retired — agent incrementality is driven by the agent_sessions ledger.
        agent_name: agentName,
      },
    };
  }

  private extractAgentName(filePath: string): string {
    const match = filePath.match(/agents[/\\]([^/\\]+)[/\\]sessions[/\\]/);
    if (match) return match[1];

    const parts = filePath.split(path.sep);
    const sessionsIdx = parts.lastIndexOf("sessions");
    if (sessionsIdx > 0) return parts[sessionsIdx - 1];

    return "unknown";
  }
}

export function hermesLayout(baseDir?: string): SessionLayout {
  const base = baseDir || path.join(os.homedir(), ".openclaw", "agents");
  return {
    baseDir: base,
    glob: "*/sessions/*.jsonl",
    sessionIdFromPath: (filePath: string) => path.basename(filePath, ".jsonl"),
    channelFromPath: (filePath: string, sessionId: string) => {
      const match = filePath.match(/([^/\\]+)[/\\]sessions[/\\]/);
      const agentName = match ? match[1] : "unknown";
      return `${agentName}/${sessionId}`;
    },
  };
}

export function createHermesCollector(baseDir?: string): AgentSessionCollector {
  const baseCollector = new AgentSessionCollector(hermesLayout(baseDir), new HermesParser(), {
    name: "OpenClaw Hermes Agent",
    description: "Collects sessions from OpenClaw Hermes agents (all agents)",
  });

  // Wrap fetch to exclude .trajectory.jsonl files
  const originalFetch = baseCollector.fetch.bind(baseCollector);
  baseCollector.fetch = async function* (opts) {
    for await (const message of originalFetch(opts)) {
      const filePath = message.metadata?.file_path as string | undefined;
      if (filePath?.endsWith(".trajectory.jsonl")) {
        continue;
      }
      yield message;
    }
  };

  return baseCollector;
}
