import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import type { LarkCliHttpClient } from "../../../../src/collectors/feishu/lark-cli-client";
import { MessageSearchSource } from "../../../../src/collectors/feishu/sources/message-search";

function createMockClient(pages: unknown[]): LarkCliHttpClient {
  let i = 0;
  return {
    request: vi.fn(),
    paginate: vi.fn(),
    execShortcut: vi
      .fn()
      .mockImplementation(async () => JSON.stringify(pages[i++] ?? pages.at(-1))),
    healthCheck: vi.fn(),
  } as unknown as LarkCliHttpClient;
}

describe("MessageSearchSource", () => {
  let staging: CursorStaging;

  beforeEach(() => {
    staging = new CursorStaging();
  });

  it("yields p2p messages from lark-cli message search", async () => {
    const client = createMockClient([
      {
        ok: true,
        data: {
          has_more: false,
          messages: [
            {
              chat_id: "oc_p2p",
              chat_type: "p2p",
              content: "你好",
              create_time: "2026-05-28 23:07",
              deleted: false,
              message_id: "om_1",
              msg_type: "text",
              sender: { id: "ou_other", id_type: "open_id", sender_type: "user" },
            },
          ],
        },
      },
    ]);
    const source = new MessageSearchSource(client, {
      chatTypes: ["p2p"],
      lookbackDays: 30,
      selfOpenId: "ou_me",
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("dm/oc_p2p");
    expect(results[0].metadata?.message_id).toBe("om_1");
    expect(results[0].metadata?.sensitivity).toBe("high");
  });

  it("paginates until has_more is false", async () => {
    const client = createMockClient([
      {
        ok: true,
        data: {
          has_more: true,
          page_token: "next",
          messages: [
            {
              chat_id: "oc_p2p",
              chat_type: "p2p",
              content: "one",
              create_time: "2026-05-28 23:07",
              message_id: "om_1",
              msg_type: "text",
              sender: { id: "ou_other", id_type: "open_id", sender_type: "user" },
            },
          ],
        },
      },
      {
        ok: true,
        data: {
          has_more: false,
          messages: [
            {
              chat_id: "oc_p2p",
              chat_type: "p2p",
              content: "two",
              create_time: "2026-05-28 23:08",
              message_id: "om_2",
              msg_type: "text",
              sender: { id: "ou_other", id_type: "open_id", sender_type: "user" },
            },
          ],
        },
      },
    ]);
    const source = new MessageSearchSource(client, { chatTypes: ["p2p"], lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    expect(client.execShortcut).toHaveBeenCalledTimes(2);
    expect(client.execShortcut).toHaveBeenLastCalledWith(
      "im",
      "messages-search",
      expect.arrayContaining(["--page-token", "next"]),
    );
  });

  it("marks self-sent messages as sent", async () => {
    const client = createMockClient([
      {
        ok: true,
        data: {
          has_more: false,
          messages: [
            {
              chat_id: "oc_p2p",
              chat_type: "p2p",
              content: "from me",
              create_time: "2026-05-28 23:07",
              message_id: "om_1",
              msg_type: "text",
              sender: { id: "ou_me", id_type: "open_id", sender_type: "user" },
            },
          ],
        },
      },
    ]);
    const source = new MessageSearchSource(client, {
      chatTypes: ["p2p"],
      lookbackDays: 30,
      selfOpenId: "ou_me",
    });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].direction).toBe("sent");
  });

  it("commits cursor per chat type", async () => {
    const client = createMockClient([
      {
        ok: true,
        data: {
          has_more: false,
          messages: [
            {
              chat_id: "oc_p2p",
              chat_type: "p2p",
              content: "cursor",
              create_time: "2026-05-28 23:07",
              message_id: "om_1",
              msg_type: "text",
              sender: { id: "ou_other", id_type: "open_id", sender_type: "user" },
            },
          ],
        },
      },
    ]);
    const source = new MessageSearchSource(client, { chatTypes: ["p2p"], lookbackDays: 30 });

    for await (const _msg of source.fetch(null, staging)) {
      // drain
    }

    expect(staging.getCommittable()).toHaveProperty("message_search");
    expect(staging.getCommittable().message_search).toHaveProperty("p2p");
  });
});
