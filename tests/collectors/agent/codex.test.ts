import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexParser, createCodexCollector } from "../../../src/collectors/agent/codex";
import type { SessionParseContext } from "../../../src/collectors/agent/types";
import type { RawMessage } from "../../../src/core/types";

describe("CodexParser", () => {
  const parser = new CodexParser();
  const baseContext: SessionParseContext = {
    sessionId: "test",
    filePath: "/test.jsonl",
    channel: "test",
    lineIndex: 0,
    sessionMeta: null,
  };

  it('should have platformId "codex"', () => {
    expect(parser.platformId).toBe("codex");
  });

  it("should parse session_meta", () => {
    const line = {
      type: "session_meta",
      payload: { id: "abc-123", cwd: "/project" },
      timestamp: "2024-01-15T09:00:00Z",
    };
    const meta = parser.parseSessionMeta(line);
    expect(meta).toEqual({
      sessionId: "abc-123",
      timestamp: "2024-01-15T09:00:00Z",
      cwd: "/project",
    });
  });

  it("should identify user response_item as conversation record", () => {
    const line = { type: "response_item", payload: { role: "user", content: [] } };
    expect(parser.isConversationRecord(line)).toBe(true);
  });

  it("should identify assistant response_item as conversation record", () => {
    const line = { type: "response_item", payload: { role: "assistant", content: [] } };
    expect(parser.isConversationRecord(line)).toBe(true);
  });

  it("should NOT identify developer response_item as conversation record", () => {
    const line = { type: "response_item", payload: { role: "developer", content: [] } };
    expect(parser.isConversationRecord(line)).toBe(false);
  });

  it("should identify event_msg user_message as conversation record", () => {
    const line = { type: "event_msg", payload: { type: "user_message", message: "hi" } };
    expect(parser.isConversationRecord(line)).toBe(true);
  });

  it("should NOT identify event_msg token_count as conversation record", () => {
    const line = { type: "event_msg", payload: { type: "token_count", tokens: 100 } };
    expect(parser.isConversationRecord(line)).toBe(false);
  });

  it("should parse user response_item and extract input_text", () => {
    const line = {
      type: "response_item",
      payload: { role: "user", content: [{ type: "input_text", text: "Fix the bug" }] },
      timestamp: "2024-01-15T09:00:02Z",
    };
    const msg = parser.parseRecord(line, baseContext);
    expect(msg).not.toBeNull();
    expect(msg?.contact).toBe("user");
    expect(msg?.content).toBe("Fix the bug");
    expect(msg?.direction).toBe("sent");
  });

  it("should parse assistant response_item, extract output_text only", () => {
    const line = {
      type: "response_item",
      payload: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking..." },
          { type: "output_text", text: "Here is the fix." },
        ],
      },
      timestamp: "2024-01-15T09:00:05Z",
    };
    const msg = parser.parseRecord(line, baseContext);
    expect(msg).not.toBeNull();
    expect(msg?.contact).toBe("assistant");
    expect(msg?.content).toBe("Here is the fix.");
    expect(msg?.content).not.toContain("thinking");
  });

  it("should skip user messages with system-injected content", () => {
    const systemTags = [
      "<environment_context>\nOS: macOS\n</environment_context>",
      "<permissions instructions>Do not run commands.</permissions>",
      "<collaboration_mode>pair</collaboration_mode>",
      "<skills_instructions>Use TDD.</skills_instructions>",
    ];
    for (const text of systemTags) {
      const line = {
        type: "response_item",
        payload: { role: "user", content: [{ type: "input_text", text }] },
        timestamp: "2024-01-15T09:00:00Z",
      };
      expect(parser.parseRecord(line, baseContext)).toBeNull();
    }
  });

  it("should parse event_msg user_message", () => {
    const line = {
      type: "event_msg",
      payload: { type: "user_message", message: "Do the thing" },
      timestamp: "2024-01-15T09:00:06Z",
    };
    const msg = parser.parseRecord(line, baseContext);
    expect(msg).not.toBeNull();
    expect(msg?.contact).toBe("user");
    expect(msg?.content).toBe("Do the thing");
  });
});

describe("createCodexCollector integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should collect messages from fixture file", async () => {
    const sessionDir = path.join(tempDir, "sessions", "2024", "01", "15");
    await fs.mkdir(sessionDir, { recursive: true });

    const fixturePath = path.join(__dirname, "../../fixtures/codex-session/rollout.jsonl");
    const targetPath = path.join(sessionDir, "rollout-20240115-090000-codex-session-001.jsonl");
    await fs.copyFile(fixturePath, targetPath);

    const collector = createCodexCollector(tempDir);
    const messages: RawMessage[] = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    // Expected: 2 real user messages + 2 assistant messages = 4
    // Skipped: 1 developer, 1 system-injected user (<environment_context>),
    //          1 event_msg user_message (deduped with response_item), 1 token_count event
    expect(messages.length).toBe(4);

    const users = messages.filter((m) => m.contact === "user");
    const assistants = messages.filter((m) => m.contact === "assistant");
    expect(users).toHaveLength(2);
    expect(assistants).toHaveLength(2);

    expect(assistants[0].content).not.toContain("think");
    expect(users.every((u) => !u.content.includes("<environment_context"))).toBe(true);
  });
});

describe("CodexParser malformed record tolerance", () => {
  const parser = new CodexParser();
  const context: SessionParseContext = {
    sessionId: "test",
    filePath: "/test.jsonl",
    channel: "test",
    lineIndex: 0,
    sessionMeta: null,
  };

  it("isConversationRecord returns false for response_item without payload", () => {
    expect(parser.isConversationRecord({ type: "response_item" })).toBe(false);
  });

  it("isConversationRecord returns false for event_msg without payload", () => {
    expect(parser.isConversationRecord({ type: "event_msg" })).toBe(false);
  });

  it("isConversationRecord returns false for response_item with null payload", () => {
    expect(parser.isConversationRecord({ type: "response_item", payload: null })).toBe(false);
  });

  it("parseSessionMeta returns null for session_meta without payload", () => {
    expect(parser.parseSessionMeta({ type: "session_meta", timestamp: "t" })).toBeNull();
  });

  it("parseRecord returns null when response_item content is not an array", () => {
    const line = {
      type: "response_item",
      payload: { role: "user", content: "not-an-array" },
      timestamp: "2024-01-15T09:00:00Z",
    };
    expect(parser.parseRecord(line, context)).toBeNull();
  });

  it("parseRecord returns null when response_item payload is missing", () => {
    const line = { type: "response_item", timestamp: "2024-01-15T09:00:00Z" };
    expect(parser.parseRecord(line, context)).toBeNull();
  });

  it("parseRecord returns null when event_msg payload is missing", () => {
    const line = { type: "event_msg", timestamp: "2024-01-15T09:00:00Z" };
    expect(parser.parseRecord(line, context)).toBeNull();
  });
});
