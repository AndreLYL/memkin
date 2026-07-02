import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import type { LarkCliHttpClient } from "../../../../src/collectors/feishu/lark-cli-client";
import { MailSource } from "../../../../src/collectors/feishu/sources/mail";

// Fixture dates are anchored relative to "now" so the default lookbackDays
// window always includes them, regardless of when the suite runs. (Previously
// these were hardcoded to 2026-05-27, which silently fell outside the 30-day
// lookback once the wall clock moved past ~2026-06-26 — every assertion then
// saw zero results.)
const DAY_MS = 24 * 60 * 60 * 1000;
const MAIL_001_DATE = new Date(Date.now() - 5 * DAY_MS).toISOString();
const MAIL_002_DATE = new Date(Date.now() - 4 * DAY_MS).toISOString();

const triageResponse = JSON.stringify([
  {
    message_id: "mail_001",
    date: MAIL_001_DATE,
    from: "alice@example.com",
    subject: "项目进度更新",
    thread_id: "thread_001",
  },
  {
    message_id: "mail_002",
    date: MAIL_002_DATE,
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
  date: MAIL_001_DATE,
  thread_id: "thread_001",
  body: "Hi，本周进度如下：\n1. 完成了后端 API\n2. 前端还在开发中",
  attachments: [{ file_name: "progress.pdf", size: 102400 }],
});

const messageResponse002 = JSON.stringify({
  message_id: "mail_002",
  subject: "会议纪要",
  from: "bob@example.com",
  to: ["me@example.com"],
  date: MAIL_002_DATE,
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
    expect(committable.mail.INBOX.last_sync_at).toBe(new Date(MAIL_002_DATE).getTime());
  });

  it("skips emails older than checkpoint", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30 });

    // Between MAIL_001 (now-5d) and MAIL_002 (now-4d): only mail_002 survives.
    const checkpoint = {
      INBOX: { last_sync_at: Date.now() - 4.5 * DAY_MS },
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

    expect(client.execShortcut).toHaveBeenCalledWith("mail", "triage", [
      "--filter",
      '{"folder":"INBOX"}',
    ]);
  });

  it("calls message with --html false", async () => {
    const client = createMockClient(
      JSON.stringify([{ message_id: "m1", date: MAIL_001_DATE, from: "a@b.com", subject: "test" }]),
      { m1: JSON.stringify({ message_id: "m1", subject: "test", from: "a@b.com", body: "hello" }) },
    );
    const source = new MailSource(client, { lookbackDays: 30 });

    for await (const _ of source.fetch(null, staging)) {
      /* consume */
    }

    expect(client.execShortcut).toHaveBeenCalledWith("mail", "message", [
      "--message-id",
      "m1",
      "--html=false",
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

  it("fetches all emails when fetch_concurrency > 1", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.metadata?.message_id).sort();
    expect(ids).toEqual(["mail_001", "mail_002"]);
  });

  it("skips failed items but yields successful ones in concurrent batch", async () => {
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
            if (id === "mail_002") throw new Error("timeout");
            return messageResponse001;
          }
        }
        return "{}";
      },
    );
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(1);
    expect(results[0].metadata?.message_id).toBe("mail_001");
  });

  it("does not advance cursor past an older failed message", async () => {
    // mail_001 (older) fails its detail fetch; mail_002 (newer) succeeds.
    // The committed cursor must stay below the failed item so the next run
    // re-includes it — otherwise mail_001 is lost forever.
    const client = createMockClient(triageResponse, {
      mail_002: messageResponse002,
    });
    (client.execShortcut as ReturnType<typeof vi.fn>).mockImplementation(
      async (_domain: string, shortcut: string, flags?: string[]) => {
        if (shortcut === "triage") return triageResponse;
        if (shortcut === "message") {
          const idIdx = flags?.indexOf("--message-id");
          if (idIdx !== undefined && idIdx >= 0 && flags) {
            const id = flags[idIdx + 1];
            if (id === "mail_001") throw new Error("rate limited");
            return messageResponse002;
          }
        }
        return "{}";
      },
    );
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    // Only the newer message was ingested this run.
    expect(results).toHaveLength(1);
    expect(results[0].metadata?.message_id).toBe("mail_002");

    // Cursor is clamped to just below the failed mail_001 (not up to mail_002).
    const committable = staging.getCommittable();
    const failedMs = new Date(MAIL_001_DATE).getTime();
    expect(committable.mail.INBOX.last_sync_at).toBe(failedMs - 1);
  });

  it("re-includes the failed message on the next fetch", async () => {
    // First run: mail_001 fails, cursor clamps below it. Second run using that
    // committed cursor must still surface mail_001 in the filtered window.
    let failMail001 = true;
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    (client.execShortcut as ReturnType<typeof vi.fn>).mockImplementation(
      async (_domain: string, shortcut: string, flags?: string[]) => {
        if (shortcut === "triage") return triageResponse;
        if (shortcut === "message") {
          const idIdx = flags?.indexOf("--message-id");
          if (idIdx !== undefined && idIdx >= 0 && flags) {
            const id = flags[idIdx + 1];
            if (id === "mail_001" && failMail001) throw new Error("rate limited");
            return id === "mail_001" ? messageResponse001 : messageResponse002;
          }
        }
        return "{}";
      },
    );
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    // First run — mail_001 fails.
    for await (const _ of source.fetch(null, staging)) {
      /* consume */
    }
    const committedCursor = staging.getCommittable().mail.INBOX;

    // Second run — mail_001 now succeeds; feed the clamped cursor back in.
    failMail001 = false;
    const secondStaging = new CursorStaging();
    const secondResults = [];
    for await (const msg of source.fetch(committedCursor, secondStaging)) {
      secondResults.push(msg);
    }

    const secondIds = secondResults.map((r) => r.metadata?.message_id);
    // The previously-failed mail_001 is re-fetched. (mail_002 may also reappear
    // via the overlap window; dedup marks it "unchanged" downstream.)
    expect(secondIds).toContain("mail_001");
  });

  it("does not advance cursor when every message fails", async () => {
    const client = createMockClient(triageResponse, {});
    (client.execShortcut as ReturnType<typeof vi.fn>).mockImplementation(
      async (_domain: string, shortcut: string) => {
        if (shortcut === "triage") return triageResponse;
        if (shortcut === "message") throw new Error("all down");
        return "{}";
      },
    );
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(0);
    // Nothing succeeded → cursor must not be committed at all.
    expect(staging.getCommittable()).not.toHaveProperty("mail");
  });

  it("advances cursor to max date when all messages succeed", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    for await (const _ of source.fetch(null, staging)) {
      /* consume */
    }

    // No failures → cursor advances to the newest message unclamped.
    const committable = staging.getCommittable();
    expect(committable.mail.INBOX.last_sync_at).toBe(new Date(MAIL_002_DATE).getTime());
  });
});
