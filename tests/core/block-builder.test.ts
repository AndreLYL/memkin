import { describe, expect, it, test } from "vitest";
import { BlockBuilder } from "../../src/core/block-builder";
import type { ConversationBlock, RawMessage } from "../../src/core/types";

async function* createGenerator(messages: RawMessage[]): AsyncGenerator<RawMessage> {
  for (const msg of messages) {
    yield msg;
  }
}

function createMessage(
  content: string,
  timestamp: string,
  contact: string,
  metadata?: Record<string, unknown>,
): RawMessage {
  return {
    platform: "test-platform",
    channel: "test-channel",
    contact,
    timestamp,
    content,
    direction: "received",
    metadata,
  };
}

// Helper for new tests
function makeMsg(content: string, overrides?: Partial<RawMessage>): RawMessage {
  return {
    platform: "feishu",
    channel: "group/oc_test",
    contact: "alice",
    timestamp: "2026-05-29T10:00:00Z",
    content,
    direction: "received",
    ...overrides,
  };
}

async function* gen(msgs: RawMessage[]): AsyncGenerator<RawMessage> {
  for (const m of msgs) yield m;
}

async function collect(gen: AsyncGenerator<ConversationBlock>): Promise<ConversationBlock[]> {
  const result: ConversationBlock[] = [];
  for await (const b of gen) result.push(b);
  return result;
}

describe("BlockBuilder", () => {
  it("should yield nothing for empty input", async () => {
    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator([]))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(0);
  });

  it("should create a single block for messages within default gap", async () => {
    const messages = [
      createMessage("Hello", "2024-01-01T10:00:00Z", "user1"),
      createMessage("Hi there", "2024-01-01T10:05:00Z", "user2"),
      createMessage("How are you?", "2024-01-01T10:10:00Z", "user1"),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].messages).toHaveLength(3);
    expect(blocks[0].participants).toEqual(["user1", "user2"]);
    expect(blocks[0].start_time).toBe("2024-01-01T10:00:00Z");
    expect(blocks[0].end_time).toBe("2024-01-01T10:10:00Z");
    expect(blocks[0].block_id).toBeTruthy();
    expect(blocks[0].platform).toBe("test-platform");
    expect(blocks[0].channel).toBe("test-channel");
  });

  it("should split blocks on time gap > 30 minutes", async () => {
    const messages = [
      createMessage("First message", "2024-01-01T10:00:00Z", "user1"),
      createMessage("Second message", "2024-01-01T10:05:00Z", "user2"),
      // 40 minutes gap
      createMessage("Third message", "2024-01-01T10:45:00Z", "user1"),
      createMessage("Fourth message", "2024-01-01T10:50:00Z", "user2"),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[0].end_time).toBe("2024-01-01T10:05:00Z");
    expect(blocks[1].messages).toHaveLength(2);
    expect(blocks[1].start_time).toBe("2024-01-01T10:45:00Z");
  });

  it("should split blocks on thread_id change", async () => {
    const messages = [
      createMessage("Thread 1 msg 1", "2024-01-01T10:00:00Z", "user1", { thread_id: "thread-1" }),
      createMessage("Thread 1 msg 2", "2024-01-01T10:01:00Z", "user2", { thread_id: "thread-1" }),
      createMessage("Thread 2 msg 1", "2024-01-01T10:02:00Z", "user1", { thread_id: "thread-2" }),
      createMessage("Thread 2 msg 2", "2024-01-01T10:03:00Z", "user2", { thread_id: "thread-2" }),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[0].thread_id).toBe("thread-1");
    expect(blocks[1].messages).toHaveLength(2);
    expect(blocks[1].thread_id).toBe("thread-2");
  });

  it("should split blocks when token count exceeds max_block_tokens", async () => {
    // Create a long message that exceeds 4000 tokens
    // For English: ~3100 words * 1.3 = 4030 tokens
    const longContent = "word ".repeat(3100);

    const messages = [
      createMessage("Short message", "2024-01-01T10:00:00Z", "user1"),
      createMessage(longContent, "2024-01-01T10:01:00Z", "user2"),
      createMessage("Another short message", "2024-01-01T10:02:00Z", "user1"),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    // First block: "Short message" (tokens < 4000)
    // When we try to add long message (4030 tokens), it would exceed, so split
    // Second block: long message alone (4030 tokens)
    // Third block: "Another short message"
    expect(blocks).toHaveLength(3);
    expect(blocks[0].messages).toHaveLength(1);
    expect(blocks[1].messages).toHaveLength(1);
    expect(blocks[2].messages).toHaveLength(1);
  });

  it("should split blocks when message count exceeds max_block_messages", async () => {
    const messages: RawMessage[] = [];
    for (let i = 0; i < 105; i++) {
      messages.push(
        createMessage(`Message ${i}`, `2024-01-01T10:${String(i).padStart(2, "0")}:00Z`, "user1"),
      );
    }

    const builder = new BlockBuilder({ max_block_messages: 100 });
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(100);
    expect(blocks[1].messages).toHaveLength(5);
  });

  it("should calculate token count for Chinese text", async () => {
    const messages = [createMessage("你好世界这是一个测试", "2024-01-01T10:00:00Z", "user1")];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    // 10 Chinese characters * 1.5 = 15 tokens
    expect(blocks[0].token_count).toBeGreaterThanOrEqual(15);
    expect(blocks[0].token_count).toBeLessThanOrEqual(16);
  });

  it("should calculate token count for English text", async () => {
    const messages = [createMessage("Hello world this is a test", "2024-01-01T10:00:00Z", "user1")];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    // 6 words * 1.3 = 7.8 tokens
    expect(blocks[0].token_count).toBeGreaterThan(7);
    expect(blocks[0].token_count).toBeLessThan(9);
  });

  it("should calculate token count for mixed Chinese and English text", async () => {
    const messages = [
      createMessage("Hello 世界 this is 一个测试", "2024-01-01T10:00:00Z", "user1"),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].token_count).toBeGreaterThan(10);
  });

  it("should respect custom configuration", async () => {
    const messages = [
      createMessage("First", "2024-01-01T10:00:00Z", "user1"),
      createMessage("Second", "2024-01-01T10:02:00Z", "user2"),
      // 7 minutes gap - should NOT split with default but SHOULD split with 5 min gap
      createMessage("Third", "2024-01-01T10:09:00Z", "user1"),
    ];

    const builder = new BlockBuilder({ block_gap_minutes: 5 });
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
    expect(blocks[0].messages).toHaveLength(2);
    expect(blocks[1].messages).toHaveLength(1);
  });

  it("should deduplicate participants correctly", async () => {
    const messages = [
      createMessage("Message 1", "2024-01-01T10:00:00Z", "user1"),
      createMessage("Message 2", "2024-01-01T10:01:00Z", "user2"),
      createMessage("Message 3", "2024-01-01T10:02:00Z", "user1"),
      createMessage("Message 4", "2024-01-01T10:03:00Z", "user2"),
      createMessage("Message 5", "2024-01-01T10:04:00Z", "user3"),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].participants.sort()).toEqual(["user1", "user2", "user3"]);
  });

  it("should handle messages without thread_id", async () => {
    const messages = [
      createMessage("Message without thread", "2024-01-01T10:00:00Z", "user1"),
      createMessage("Another without thread", "2024-01-01T10:01:00Z", "user2"),
    ];

    const builder = new BlockBuilder();
    const blocks = [];

    for await (const block of builder.build(createGenerator(messages))) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].thread_id).toBeUndefined();
  });
});

describe("BlockBuilder — source-aware split rules", () => {
  test("Rule 0: different channel forces split", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("msg1", { channel: "group/oc_abc", timestamp: "2026-05-29T10:00:00Z" }),
      makeMsg("msg2", { channel: "group/oc_def", timestamp: "2026-05-29T10:00:30Z" }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
    expect(blocks[0].channel).toBe("group/oc_abc");
    expect(blocks[1].channel).toBe("group/oc_def");
  });

  test("Rule 0: different platform forces split", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("msg1", {
        platform: "feishu",
        channel: "group/oc_abc",
        timestamp: "2026-05-29T10:00:00Z",
      }),
      makeMsg("msg2", {
        platform: "agent",
        channel: "claude-code/session1",
        timestamp: "2026-05-29T10:00:30Z",
      }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
  });

  test("Rule 0a: email messages are standalone blocks", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("chat msg", { channel: "group/oc_abc", timestamp: "2026-05-29T10:00:00Z" }),
      makeMsg("Subject1\n\nEmail body 1", {
        channel: "mail/INBOX",
        timestamp: "2026-05-29T10:00:30Z",
      }),
      makeMsg("Subject2\n\nEmail body 2", {
        channel: "mail/INBOX",
        timestamp: "2026-05-29T10:01:00Z",
      }),
      makeMsg("chat msg2", { channel: "group/oc_abc", timestamp: "2026-05-29T10:01:30Z" }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(4);
    expect(blocks[0].channel).toBe("group/oc_abc");
    expect(blocks[1].channel).toBe("mail/INBOX");
    expect(blocks[1].messages.length).toBe(1);
    expect(blocks[2].channel).toBe("mail/INBOX");
    expect(blocks[2].messages.length).toBe(1);
    expect(blocks[3].channel).toBe("group/oc_abc");
  });

  test("Rule 0b: calendar events are standalone blocks", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("event1", { channel: "calendar/primary", timestamp: "2026-05-29T10:00:00Z" }),
      makeMsg("event2", { channel: "calendar/primary", timestamp: "2026-05-29T10:01:00Z" }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
    expect(blocks[0].messages.length).toBe(1);
    expect(blocks[1].messages.length).toBe(1);
  });

  test("Rule 0b: tasks are standalone blocks", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("task1", { channel: "tasks", timestamp: "2026-05-29T10:00:00Z" }),
      makeMsg("task2", { channel: "tasks", timestamp: "2026-05-29T10:01:00Z" }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
  });

  test("Rule 0c: documents split by doc_token metadata", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("doc1 content", {
        channel: "docs/folder1",
        timestamp: "2026-05-29T10:00:00Z",
        metadata: { doc_token: "doc_aaa" },
      }),
      makeMsg("doc1 page2", {
        channel: "docs/folder1",
        timestamp: "2026-05-29T10:01:00Z",
        metadata: { doc_token: "doc_aaa" },
      }),
      makeMsg("doc2 content", {
        channel: "docs/folder1",
        timestamp: "2026-05-29T10:02:00Z",
        metadata: { doc_token: "doc_bbb" },
      }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
    expect(blocks[0].messages.length).toBe(2);
    expect(blocks[1].messages.length).toBe(1);
  });

  test("Rule 0c: documents without doc_token are standalone", async () => {
    const builder = new BlockBuilder();
    const messages = gen([
      makeMsg("doc1", { channel: "docs/folder1", timestamp: "2026-05-29T10:00:00Z" }),
      makeMsg("doc2", { channel: "docs/folder1", timestamp: "2026-05-29T10:01:00Z" }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
  });

  test("existing chat rules still apply within same channel", async () => {
    const builder = new BlockBuilder({ block_gap_minutes: 5 });
    const messages = gen([
      makeMsg("msg1", { channel: "group/oc_abc", timestamp: "2026-05-29T10:00:00Z" }),
      makeMsg("msg2", { channel: "group/oc_abc", timestamp: "2026-05-29T10:02:00Z" }),
      makeMsg("msg3", { channel: "group/oc_abc", timestamp: "2026-05-29T10:10:00Z" }),
    ]);
    const blocks = await collect(builder.build(messages));
    expect(blocks.length).toBe(2);
    expect(blocks[0].messages.length).toBe(2);
    expect(blocks[1].messages.length).toBe(1);
  });
});
