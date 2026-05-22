import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FeishuHttpClient, PagedResult } from "../../../../src/collectors/feishu/http-client";
import type { FeishuMessage } from "../../../../src/collectors/feishu/types";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import { MessageSource } from "../../../../src/collectors/feishu/sources/messages";

function createMockClient(pages: Array<{ items: FeishuMessage[]; has_more: boolean }>): FeishuHttpClient {
  return {
    paginate: vi.fn(async function* () {
      for (const page of pages) {
        yield page as PagedResult<FeishuMessage>;
      }
    }),
    request: vi.fn(),
  } as any;
}

describe("MessageSource", () => {
  const chatId = "oc_test_chat_001";
  const testMessages: FeishuMessage[] = [
    {
      message_id: "om_dc13264520392913993dd051dba21dcf",
      root_id: "",
      parent_id: "",
      create_time: "1716300000000",
      chat_id: chatId,
      msg_type: "text",
      content: '{"text":"大家好，今天的站会讨论一下进度"}',
      sender: { id: "ou_user_001", id_type: "open_id", sender_type: "user" },
      mentions: [],
    },
    {
      message_id: "om_reply_001",
      root_id: "om_dc13264520392913993dd051dba21dcf",
      parent_id: "om_dc13264520392913993dd051dba21dcf",
      create_time: "1716300060000",
      chat_id: chatId,
      msg_type: "text",
      content: '{"text":"我这边API开发完成了，等测试"}',
      sender: { id: "ou_user_002", id_type: "open_id", sender_type: "user" },
      mentions: [{ key: "@_user_1", id: { open_id: "ou_user_001" }, name: "张三" }],
    },
    {
      message_id: "om_image_001",
      root_id: "",
      parent_id: "",
      create_time: "1716300120000",
      chat_id: chatId,
      msg_type: "image",
      content: '{"image_key":"img_v3_001"}',
      sender: { id: "ou_user_003", id_type: "open_id", sender_type: "user" },
    },
  ];

  let staging: CursorStaging;

  beforeEach(() => {
    staging = new CursorStaging();
  });

  it("yields RawMessage for each message", async () => {
    const client = createMockClient([{ items: testMessages, has_more: false }]);
    const source = new MessageSource(client, [chatId], { lookbackDays: 7 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      platform: "feishu",
      channel: `group/${chatId}`,
      contact: "ou_user_001",
      content: "大家好，今天的站会讨论一下进度",
    });
    expect(results[0].metadata).toMatchObject({
      message_id: "om_dc13264520392913993dd051dba21dcf",
    });
  });

  it("maps thread metadata (root_id/parent_id)", async () => {
    const client = createMockClient([{ items: testMessages, has_more: false }]);
    const source = new MessageSource(client, [chatId], { lookbackDays: 7 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[1].metadata).toMatchObject({
      root_id: "om_dc13264520392913993dd051dba21dcf",
      parent_id: "om_dc13264520392913993dd051dba21dcf",
    });
    expect(results[0].metadata).toHaveProperty("root_id", null);
    expect(results[0].metadata).toHaveProperty("parent_id", null);
  });

  it("handles image msg_type → content '[图片]'", async () => {
    const client = createMockClient([{ items: [testMessages[2]], has_more: false }]);
    const source = new MessageSource(client, [chatId], { lookbackDays: 7 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].content).toBe("[图片]");
  });

  it("commits cursor after successful chat", async () => {
    const client = createMockClient([{ items: testMessages, has_more: false }]);
    const source = new MessageSource(client, [chatId], { lookbackDays: 7 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    const committable = staging.getCommittable();
    expect(committable).toHaveProperty("messages");
    expect(committable.messages).toHaveProperty(chatId);
    expect(committable.messages[chatId]).toHaveProperty("last_sync_at");
    expect(committable.messages[chatId].last_sync_at).toBe(1716300120000);
  });

  it("uses checkpoint for incremental sync", async () => {
    const client = createMockClient([{ items: testMessages, has_more: false }]);
    const source = new MessageSource(client, [chatId], { lookbackDays: 7 });

    const checkpoint = {
      [chatId]: { last_sync_at: 1716200000000 },
    };

    const results = [];
    for await (const msg of source.fetch(checkpoint, staging)) {
      results.push(msg);
    }

    expect(client.paginate).toHaveBeenCalledWith(
      "/open-apis/im/v1/messages",
      expect.objectContaining({
        start_time: expect.any(String),
      })
    );

    const callArgs = (client.paginate as any).mock.calls[0][1];
    const startTimeSec = Number.parseInt(callArgs.start_time, 10);
    expect(startTimeSec).toBe(Math.floor((1716200000000 - 2000) / 1000));
  });

  it("does not commit cursor when paginate throws", async () => {
    const mockPaginate = vi.fn(async function* () {
      yield { items: [testMessages[0]], has_more: false } as PagedResult<FeishuMessage>;
      throw new Error("Network failure");
    });

    const client = { paginate: mockPaginate, request: vi.fn() } as any;
    const source = new MessageSource(client, [chatId], { lookbackDays: 7 });

    const results = [];
    try {
      for await (const msg of source.fetch(null, staging)) {
        results.push(msg);
      }
    } catch (err: any) {
      expect(err.message).toBe("Network failure");
    }

    expect(results).toHaveLength(1);
    const committable = staging.getCommittable();
    expect(committable.messages?.[chatId]).toBeUndefined();
  });
});
