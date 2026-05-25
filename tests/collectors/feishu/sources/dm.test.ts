import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import type { FeishuHttpClient, PagedResult } from "../../../../src/collectors/feishu/http-client";
import { DMSource } from "../../../../src/collectors/feishu/sources/dm";
import type { FeishuMessage } from "../../../../src/collectors/feishu/types";

function createMockClient(items: FeishuMessage[]): FeishuHttpClient {
  return {
    request: vi.fn(),
    paginate: vi.fn().mockImplementation(async function* () {
      yield { items, has_more: false } as PagedResult<FeishuMessage>;
    }),
  } as unknown as FeishuHttpClient;
}

describe("DMSource", () => {
  const selfOpenId = "ou_self_001";
  const chatId = "oc_dm_chat_001";
  const testMessages: FeishuMessage[] = [
    {
      message_id: "om_dm_001",
      root_id: "",
      parent_id: "",
      create_time: "1716300000000",
      chat_id: chatId,
      msg_type: "text",
      body: { content: '{"text":"我发的消息"}' },
      sender: { id: selfOpenId, id_type: "open_id", sender_type: "user" },
    },
    {
      message_id: "om_dm_002",
      root_id: "",
      parent_id: "",
      create_time: "1716300001000",
      chat_id: chatId,
      msg_type: "text",
      body: { content: '{"text":"对方的回复"}' },
      sender: { id: "ou_other_001", id_type: "open_id", sender_type: "user" },
    },
  ];

  let staging: CursorStaging;

  beforeEach(() => {
    staging = new CursorStaging();
  });

  it("yields RawMessage with dm/ channel prefix", async () => {
    const client = createMockClient(testMessages);
    const source = new DMSource(client, [chatId], {
      lookbackDays: 7,
      selfOpenId,
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    expect(results[0].channel).toBe(`dm/${chatId}`);
    expect(results[1].channel).toBe(`dm/${chatId}`);
  });

  it("marks self-sent messages as 'sent'", async () => {
    const client = createMockClient(testMessages);
    const source = new DMSource(client, [chatId], {
      lookbackDays: 7,
      selfOpenId,
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].direction).toBe("sent");
    expect(results[0].contact).toBe(selfOpenId);
  });

  it("marks received messages as 'received'", async () => {
    const client = createMockClient(testMessages);
    const source = new DMSource(client, [chatId], {
      lookbackDays: 7,
      selfOpenId,
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[1].direction).toBe("received");
    expect(results[1].contact).toBe("ou_other_001");
  });

  it("adds sensitivity: high to metadata", async () => {
    const client = createMockClient(testMessages);
    const source = new DMSource(client, [chatId], {
      lookbackDays: 7,
      selfOpenId,
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].metadata?.sensitivity).toBe("high");
    expect(results[1].metadata?.sensitivity).toBe("high");
  });

  it("commits cursor with max create_time", async () => {
    const client = createMockClient(testMessages);
    const source = new DMSource(client, [chatId], {
      lookbackDays: 7,
      selfOpenId,
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    const committable = staging.getCommittable();
    expect(committable).toHaveProperty("dm");
    expect(committable.dm).toHaveProperty(chatId);
    expect(committable.dm[chatId]).toHaveProperty("last_sync_at");
    expect(committable.dm[chatId].last_sync_at).toBe(1716300001000);
  });
});
