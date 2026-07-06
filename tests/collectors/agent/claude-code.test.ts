import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClaudeCodeCollector } from "../../../src/collectors/agent/claude-code";

describe("ClaudeCodeCollector", () => {
  let tempDir: string;
  let collector: ReturnType<typeof createClaudeCodeCollector>;

  beforeEach(async () => {
    // Create temporary directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-code-test-"));
    collector = createClaudeCodeCollector(tempDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should have correct collector metadata", () => {
    expect(collector.id).toBe("claude-code");
    expect(collector.name).toBe("Claude Code Agent");
    expect(collector.description).toContain("Claude Code");
  });

  it("should pass health check when directory exists", async () => {
    const result = await collector.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("exist");
  });

  it("should fail health check when directory does not exist", async () => {
    const nonExistentCollector = createClaudeCodeCollector("/non/existent/path");
    const result = await nonExistentCollector.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("should parse JSONL file and extract messages", async () => {
    // Copy fixture to temp directory structure
    const projectDir = path.join(tempDir, "test-project");
    await fs.mkdir(projectDir, { recursive: true });

    const fixturePath = path.join(__dirname, "../../fixtures/claude-code-session/sample.jsonl");
    const targetPath = path.join(projectDir, "session-001.jsonl");
    await fs.copyFile(fixturePath, targetPath);

    const messages = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    // Should extract 3 user messages and 2 assistant messages (5 total)
    expect(messages.length).toBe(5);

    // Check first user message
    const firstUser = messages[0];
    expect(firstUser.platform).toBe("claude-code");
    expect(firstUser.channel).toBe("test-session-001");
    expect(firstUser.contact).toBe("user");
    expect(firstUser.direction).toBe("sent");
    expect(firstUser.content).toContain("Hello, can you help me");
    expect(firstUser.timestamp).toBe("2024-01-01T10:00:01.000Z");
    expect(firstUser.metadata?.session_id).toBe("test-session-001");
    expect(firstUser.metadata?.uuid).toBe("uuid-001");
    // cursor field retired (PR-0): incrementality is driven by the agent_sessions ledger.
    expect(firstUser.metadata?.cursor).toBeUndefined();

    // Check first assistant message
    const firstAssistant = messages[1];
    expect(firstAssistant.platform).toBe("claude-code");
    expect(firstAssistant.contact).toBe("assistant");
    expect(firstAssistant.direction).toBe("received");
    expect(firstAssistant.content).toContain("Of course!");
    expect(firstAssistant.metadata?.session_id).toBe("test-session-001");
    expect(firstAssistant.metadata?.uuid).toBe("uuid-002");
  });

  it("ignores the legacy cursor and yields all sessions (cursor retired in PR-0)", async () => {
    // The former cursor-based pagination (`sessionId <= cursor`) is retired: it silently
    // dropped the first message of any session sorting before the cursor and lost
    // single-message / recovered sessions. Incrementality now lives in the agent_sessions
    // ledger, so the collector yields every turn regardless of the cursor value.
    const projectDir = path.join(tempDir, "test-project");
    await fs.mkdir(projectDir, { recursive: true });

    // Session 1
    const session1 = path.join(projectDir, "session-001.jsonl");
    await fs.writeFile(
      session1,
      '{"type":"user","message":{"role":"user","content":"First session"},"uuid":"s1-001","timestamp":"2024-01-01T10:00:00.000Z","sessionId":"session-001"}\n',
    );

    // Session 2
    const session2 = path.join(projectDir, "session-002.jsonl");
    await fs.writeFile(
      session2,
      '{"type":"user","message":{"role":"user","content":"Second session"},"uuid":"s2-001","timestamp":"2024-01-01T11:00:00.000Z","sessionId":"session-002"}\n',
    );

    // No cursor — both sessions.
    const allMessages = [];
    for await (const msg of collector.fetch({})) {
      allMessages.push(msg);
    }
    expect(allMessages.length).toBe(2);

    // A stale cursor is now ignored — both sessions still yielded (no first-message drop).
    const withCursor = [];
    for await (const msg of collector.fetch({ cursor: "session-001" })) {
      withCursor.push(msg);
    }
    expect(withCursor.length).toBe(2);
    const ids = withCursor.map((m) => m.metadata?.session_id);
    expect(ids).toContain("session-001");
    expect(ids).toContain("session-002");
  });

  it("should normalize metadata field names to snake_case", async () => {
    const projectDir = path.join(tempDir, "test-project");
    await fs.mkdir(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, "session-test.jsonl");
    await fs.writeFile(
      sessionFile,
      '{"type":"user","message":{"role":"user","content":"Test"},"uuid":"test-uuid","timestamp":"2024-01-01T10:00:00.000Z","sessionId":"test-session","cwd":"/test/path"}\n',
    );

    const messages = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    expect(messages.length).toBe(1);
    const metadata = messages[0].metadata;

    // Should have snake_case keys
    expect(metadata?.session_id).toBe("test-session");
    expect(metadata?.uuid).toBe("test-uuid");
    // cursor field retired (PR-0).
    expect(metadata?.cursor).toBeUndefined();

    // Should NOT have camelCase keys
    expect(metadata?.sessionId).toBeUndefined();
  });

  it("should skip assistant messages with only tool_use content", async () => {
    const projectDir = path.join(tempDir, "test-project");
    await fs.mkdir(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, "session-test.jsonl");
    // Assistant message with array content (tool_use only, no text blocks)
    await fs.writeFile(
      sessionFile,
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/test.ts"}}]},"uuid":"test-uuid","timestamp":"2024-01-01T10:00:00.000Z","sessionId":"test-session"}\n',
    );

    const messages = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    expect(messages.length).toBe(0);
  });

  it("should yield empty when no JSONL files found", async () => {
    const emptyDir = path.join(tempDir, "empty-project");
    await fs.mkdir(emptyDir, { recursive: true });

    const messages = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    expect(messages.length).toBe(0);
  });

  it("should scan multiple project directories", async () => {
    // Create two project directories
    const project1 = path.join(tempDir, "project-1");
    const project2 = path.join(tempDir, "project-2");
    await fs.mkdir(project1, { recursive: true });
    await fs.mkdir(project2, { recursive: true });

    // Add sessions to each
    await fs.writeFile(
      path.join(project1, "session-1.jsonl"),
      '{"type":"user","message":{"role":"user","content":"Project 1"},"uuid":"p1-001","timestamp":"2024-01-01T10:00:00.000Z","sessionId":"p1-session"}\n',
    );
    await fs.writeFile(
      path.join(project2, "session-2.jsonl"),
      '{"type":"user","message":{"role":"user","content":"Project 2"},"uuid":"p2-001","timestamp":"2024-01-01T11:00:00.000Z","sessionId":"p2-session"}\n',
    );

    const messages = [];
    for await (const msg of collector.fetch({})) {
      messages.push(msg);
    }

    expect(messages.length).toBe(2);
    const sessionIds = messages.map((m) => m.metadata?.session_id);
    expect(sessionIds).toContain("p1-session");
    expect(sessionIds).toContain("p2-session");
  });
});
