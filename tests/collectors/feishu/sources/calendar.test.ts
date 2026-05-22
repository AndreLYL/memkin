import { describe, expect, it, vi } from "vitest";
import type { FeishuHttpClient } from "../../../../src/collectors/feishu/http-client";
import { CalendarSource } from "../../../../src/collectors/feishu/sources/calendar";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
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

    const msg1 = messages[0] as { platform: string; channel: string; content: string; metadata?: { event_id?: string } };
    expect(msg1.platform).toBe("feishu");
    expect(msg1.channel).toBe("calendar/cal_001");
    expect(msg1.content).toContain("Sprint Review Week 20");
    expect(msg1.metadata?.event_id).toBe("evt_001");

    const msg2 = messages[1] as { platform: string; channel: string; content: string; metadata?: { event_id?: string } };
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

    const msg1 = messages[0] as { metadata?: { attendees?: Array<{ id?: string; name?: string; status?: string }> } };
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

    const checkpoint = {
      calendar: {
        cal_001: { sync_token: "prior_token_xyz" },
      },
    };

    for await (const _msg of source.fetch(checkpoint, staging)) {
      // Just consume
    }

    expect(requestMock).toHaveBeenCalledWith("GET", "/open-apis/calendar/v4/calendars/cal_001/events", {
      params: { sync_token: "prior_token_xyz" },
    });
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
