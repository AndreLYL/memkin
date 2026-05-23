import { describe, it, expect } from "vitest";
import { BlockBuilder } from "../../src/core/block-builder";
import type { RawMessage } from "../../src/core/types";

function msg(overrides: Partial<RawMessage> & { content: string }): RawMessage {
  return {
    platform: "feishu",
    channel: "group/oc_chat_001",
    contact: "ou_user_001",
    timestamp: new Date().toISOString(),
    direction: "received",
    ...overrides,
  };
}

describe("BlockBuilder feishu thread grouping", () => {
  it("groups messages with same root_id into one block", async () => {
    const builder = new BlockBuilder({ block_gap_minutes: 30, max_block_messages: 100 });
    const now = Date.now();

    const messages: RawMessage[] = [
      msg({
        content: "root message",
        timestamp: new Date(now).toISOString(),
        metadata: { message_id: "om_root", root_id: null, parent_id: null },
      }),
      msg({
        content: "reply 1",
        timestamp: new Date(now + 1000).toISOString(),
        metadata: { message_id: "om_r1", root_id: "om_root", parent_id: "om_root" },
      }),
      msg({
        content: "reply 2",
        timestamp: new Date(now + 2000).toISOString(),
        metadata: { message_id: "om_r2", root_id: "om_root", parent_id: "om_r1" },
      }),
    ];

    const blocks: any[] = [];
    for await (const block of builder.build(
      (async function* () { for (const m of messages) yield m; })(),
    )) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].messages).toHaveLength(3);
    expect(blocks[0].thread_id).toBe("om_root");
  });

  it("splits blocks when thread_id changes", async () => {
    const builder = new BlockBuilder({ block_gap_minutes: 30, max_block_messages: 100 });
    const now = Date.now();

    const messages: RawMessage[] = [
      msg({
        content: "thread A msg",
        timestamp: new Date(now).toISOString(),
        metadata: { root_id: "om_thread_a" },
      }),
      msg({
        content: "thread B msg",
        timestamp: new Date(now + 1000).toISOString(),
        metadata: { root_id: "om_thread_b" },
      }),
    ];

    const blocks: any[] = [];
    for await (const block of builder.build(
      (async function* () { for (const m of messages) yield m; })(),
    )) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(2);
  });

  it("falls back to metadata.thread_id when root_id is absent", async () => {
    const builder = new BlockBuilder({ block_gap_minutes: 30, max_block_messages: 100 });
    const now = Date.now();

    const messages: RawMessage[] = [
      msg({
        content: "agent session msg",
        timestamp: new Date(now).toISOString(),
        metadata: { thread_id: "session_001" },
      }),
      msg({
        content: "agent session msg 2",
        timestamp: new Date(now + 1000).toISOString(),
        metadata: { thread_id: "session_001" },
      }),
    ];

    const blocks: any[] = [];
    for await (const block of builder.build(
      (async function* () { for (const m of messages) yield m; })(),
    )) {
      blocks.push(block);
    }

    expect(blocks).toHaveLength(1);
    expect(blocks[0].thread_id).toBe("session_001");
  });
});
