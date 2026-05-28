import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import type { LarkCliHttpClient } from "../../../../src/collectors/feishu/lark-cli-client";
import { MailSource } from "../../../../src/collectors/feishu/sources/mail";

const triageResponse = JSON.stringify([
  {
    message_id: "mail_001",
    date: "2026-05-27T10:00:00Z",
    from: "alice@example.com",
    subject: "项目进度更新",
    thread_id: "thread_001",
  },
  {
    message_id: "mail_002",
    date: "2026-05-27T14:30:00Z",
    from: "bob@example.com",
    subject: "会议纪要",
  },
]);

const messageResponse001 = JSON.stringify({
  message_id: "mail_001",
  subject: "项目进度更新",
  from: "alice@example.com",
  to: ["me@example.com"],
  cc: ["team@example.com"],
  date: "2026-05-27T10:00:00Z",
  thread_id: "thread_001",
  body: "Hi，本周进度如下：\n1. 完成了后端 API\n2. 前端还在开发中",
  attachments: [{ file_name: "progress.pdf", size: 102400 }],
});

const messageResponse002 = JSON.stringify({
  message_id: "mail_002",
  subject: "会议纪要",
  from: "bob@example.com",
  to: ["me@example.com"],
  date: "2026-05-27T14:30:00Z",
  body: "今天讨论了以下事项：\n- 发布计划\n- 测试安排",
});

function createMockClient(
  triageOut: string,
  messageOuts: Record<string, string>,
): LarkCliHttpClient {
  return {
    request: vi.fn(),
    paginate: vi.fn(),
    execShortcut: vi
      .fn()
      .mockImplementation(async (_domain: string, shortcut: string, flags?: string[]) => {
        if (shortcut === "triage") return triageOut;
        if (shortcut === "message") {
          const idIdx = flags?.indexOf("--message-id");
          if (idIdx !== undefined && idIdx >= 0 && flags) {
            const id = flags[idIdx + 1];
            return messageOuts[id] ?? "{}";
          }
        }
        return "{}";
      }),
    healthCheck: vi.fn(),
  } as unknown as LarkCliHttpClient;
}

describe("MailSource", () => {
  let staging: CursorStaging;

  beforeEach(() => {
    staging = new CursorStaging();
  });

  it("yields RawMessage for each email", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
  });

  it("sets channel to mail/INBOX", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].channel).toBe("mail/INBOX");
    expect(results[1].channel).toBe("mail/INBOX");
  });

  it("sets direction to received for inbox mail", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].direction).toBe("received");
    expect(results[1].direction).toBe("received");
  });

  it("combines subject and body as content", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].content).toContain("项目进度更新");
    expect(results[0].content).toContain("完成了后端 API");
  });

  it("sets contact to sender email", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].contact).toBe("alice@example.com");
    expect(results[1].contact).toBe("bob@example.com");
  });

  it("includes to/cc/attachments in metadata", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results[0].metadata?.to).toEqual(["me@example.com"]);
    expect(results[0].metadata?.cc).toEqual(["team@example.com"]);
    expect(results[0].metadata?.has_attachments).toBe(true);
    expect(results[0].metadata?.sensitivity).toBe("high");
    expect(results[0].attachments).toHaveLength(1);
    expect(results[0].attachments?.[0].name).toBe("progress.pdf");
  });

  it("commits cursor with max date", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    const committable = staging.getCommittable();
    expect(committable).toHaveProperty("mail");
    expect(committable.mail).toHaveProperty("INBOX");
    expect(committable.mail.INBOX.last_sync_at).toBe(new Date("2026-05-27T14:30:00Z").getTime());
  });

  it("skips emails older than checkpoint", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    const checkpoint = {
      INBOX: { last_sync_at: new Date("2026-05-27T12:00:00Z").getTime() },
    };

    const results = [];
    for await (const msg of source.fetch(checkpoint, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(1);
    expect(results[0].metadata?.message_id).toBe("mail_002");
  });

  it("calls triage with --folder INBOX", async () => {
    const client = createMockClient("[]", {});
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(client.execShortcut).toHaveBeenCalledWith("mail", "triage", ["--folder", "INBOX"]);
  });

  it("calls message with --html false", async () => {
    const client = createMockClient(
      JSON.stringify([
        { message_id: "m1", date: "2026-05-27T10:00:00Z", from: "a@b.com", subject: "test" },
      ]),
      { m1: JSON.stringify({ message_id: "m1", subject: "test", from: "a@b.com", body: "hello" }) },
    );
    const source = new MailSource(client, { lookbackDays: 30 });

    for await (const _ of source.fetch(null, staging)) {
      /* consume */
    }

    expect(client.execShortcut).toHaveBeenCalledWith("mail", "message", [
      "--message-id",
      "m1",
      "--html",
      "false",
    ]);
  });

  it("handles empty triage response", async () => {
    const client = createMockClient("[]", {});
    const source = new MailSource(client, { lookbackDays: 30 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(0);
  });

  it("skips message when detail fetch fails", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
    });
    (client.execShortcut as ReturnType<typeof vi.fn>).mockImplementation(
      async (_domain: string, shortcut: string, flags?: string[]) => {
        if (shortcut === "triage") return triageResponse;
        if (shortcut === "message") {
          const idIdx = flags?.indexOf("--message-id");
          if (idIdx !== undefined && idIdx >= 0 && flags) {
            const id = flags[idIdx + 1];
            if (id === "mail_002") throw new Error("fetch failed");
            return messageResponse001;
          }
        }
        return "{}";
      },
    );

    const source = new MailSource(client, { lookbackDays: 30 });
    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(1);
    expect(results[0].metadata?.message_id).toBe("mail_001");
  });
});
