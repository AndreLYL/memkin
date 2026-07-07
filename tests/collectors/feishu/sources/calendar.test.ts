import { describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import type { FeishuHttpClient } from "../../../../src/collectors/feishu/http-client";
import { CalendarSource } from "../../../../src/collectors/feishu/sources/calendar";
import fixtureData from "../fixtures/calendar-events.json";

function createMockClient(responseData: unknown): FeishuHttpClient {
  return {
    request: vi.fn().mockResolvedValue({ code: 0, data: responseData }),
    paginate: vi.fn(),
  } as unknown as FeishuHttpClient;
}

describe("CalendarSource", () => {
  it("yields RawMessage for each event", async () => {
    const client = createMockClient(fixtureData.data);
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);

    const msg1 = messages[0] as {
      platform: string;
      channel: string;
      content: string;
      metadata?: { event_id?: string };
    };
    expect(msg1.platform).toBe("feishu");
    expect(msg1.channel).toBe("calendar/cal_001");
    expect(msg1.content).toContain("Sprint Review Week 20");
    expect(msg1.metadata?.event_id).toBe("evt_001");

    const msg2 = messages[1] as {
      platform: string;
      channel: string;
      content: string;
      metadata?: { event_id?: string };
    };
    expect(msg2.platform).toBe("feishu");
    expect(msg2.channel).toBe("calendar/cal_001");
    expect(msg2.content).toContain("1:1 with Manager");
    expect(msg2.metadata?.event_id).toBe("evt_002");
  });

  it("maps attendees correctly", async () => {
    const client = createMockClient(fixtureData.data);
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    const msg1 = messages[0] as {
      metadata?: { attendees?: Array<{ id?: string; name?: string; status?: string }> };
    };
    expect(msg1.metadata?.attendees).toHaveLength(2);
    expect(msg1.metadata?.attendees?.[0]).toEqual({
      id: "ou_user_001",
      name: "张三",
      status: "accept",
    });
    expect(msg1.metadata?.attendees?.[1]).toEqual({
      id: "ou_user_002",
      name: "王五",
      status: "tentative",
    });
  });

  it("commits sync_token cursor after fetch", async () => {
    const client = createMockClient(fixtureData.data);
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    for await (const _msg of source.fetch(null, staging)) {
      // Just consume
    }

    const committable = staging.getCommittable();
    expect(committable).toHaveProperty("calendar");
    expect(committable.calendar).toHaveProperty("cal_001");
    expect(committable.calendar.cal_001).toEqual({ sync_token: "sync_token_v2_abc123" });
  });

  it("uses sync_token from checkpoint for incremental", async () => {
    const requestMock = vi.fn().mockResolvedValue({ code: 0, data: fixtureData.data });
    const client = { request: requestMock, paginate: vi.fn() } as unknown as FeishuHttpClient;
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    // The collector injects `lastCheckpoint["calendar"]` into the source, so the
    // per-source checkpoint IS the per-calendar map — NOT wrapped in another
    // `.calendar` key. See FeishuCollector.fetch (collector.ts).
    const checkpoint = {
      cal_001: { sync_token: "prior_token_xyz" },
    };

    for await (const _msg of source.fetch(checkpoint, staging)) {
      // Just consume
    }

    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/open-apis/calendar/v4/calendars/cal_001/events",
      {
        params: { sync_token: "prior_token_xyz" },
      },
    );
  });

  it("round-trips: committed cursor shape feeds back as next-run checkpoint", async () => {
    // Run 1: no checkpoint → full window; stages + commits sync_token.
    const client1 = createMockClient(fixtureData.data);
    const source1 = new CalendarSource(client1, ["cal_001"]);
    const staging1 = new CursorStaging();
    for await (const _msg of source1.fetch(null, staging1)) {
      // consume
    }
    const committable = staging1.getCommittable();

    // The collector extracts `committable.calendar` and injects it as the
    // per-source checkpoint on the next run.
    const nextCheckpoint = committable.calendar;
    expect(nextCheckpoint).toEqual({ cal_001: { sync_token: "sync_token_v2_abc123" } });

    // Run 2: receiving that checkpoint must restore the sync_token into params.
    const requestMock = vi.fn().mockResolvedValue({ code: 0, data: fixtureData.data });
    const client2 = { request: requestMock, paginate: vi.fn() } as unknown as FeishuHttpClient;
    const source2 = new CalendarSource(client2, ["cal_001"]);
    const staging2 = new CursorStaging();
    for await (const _msg of source2.fetch(nextCheckpoint, staging2)) {
      // consume
    }

    expect(requestMock).toHaveBeenCalledWith(
      "GET",
      "/open-apis/calendar/v4/calendars/cal_001/events",
      {
        params: { sync_token: "sync_token_v2_abc123" },
      },
    );
  });

  it("paginates through all pages when has_more is true", async () => {
    const [event1, event2] = fixtureData.data.items;
    const page1 = {
      items: [event1],
      has_more: true,
      page_token: "page_token_p2",
    };
    const page2 = {
      items: [event2],
      has_more: false,
      sync_token: "sync_token_final",
    };
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, data: page1 })
      .mockResolvedValueOnce({ code: 0, data: page2 });
    const client = { request: requestMock, paginate: vi.fn() } as unknown as FeishuHttpClient;
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    const messages: Array<{ metadata?: { event_id?: string } }> = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg as { metadata?: { event_id?: string } });
    }

    // Both pages' events must be produced — page 2 was previously dropped.
    expect(messages).toHaveLength(2);
    expect(messages[0]?.metadata?.event_id).toBe("evt_001");
    expect(messages[1]?.metadata?.event_id).toBe("evt_002");

    // Second request must carry the page_token from page 1.
    expect(requestMock).toHaveBeenCalledTimes(2);
    const secondCallOpts = requestMock.mock.calls[1]?.[2] as { params: Record<string, string> };
    expect(secondCallOpts.params.page_token).toBe("page_token_p2");

    // sync_token arrives on the final page and must be committed.
    const committable = staging.getCommittable();
    expect(committable.calendar.cal_001).toEqual({ sync_token: "sync_token_final" });
  });

  it("stops paginating when has_more is false even if page_token present", async () => {
    const requestMock = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        items: fixtureData.data.items,
        has_more: false,
        page_token: "stale_token",
        sync_token: "sync_token_v2_abc123",
      },
    });
    const client = { request: requestMock, paginate: vi.fn() } as unknown as FeishuHttpClient;
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("commits cursor even with 0 events", async () => {
    const emptyResponse = {
      items: [],
      has_more: false,
      sync_token: "sync_token_v2_def456",
    };
    const client = createMockClient(emptyResponse);
    const source = new CalendarSource(client, ["cal_001"]);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(0);

    const committable = staging.getCommittable();
    expect(committable.calendar.cal_001).toEqual({ sync_token: "sync_token_v2_def456" });
  });
});
