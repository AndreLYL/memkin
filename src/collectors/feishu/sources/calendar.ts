import type { RawMessage } from "../../../core/types.js";
import type { CursorStaging } from "../cursor-staging.js";
import type { FeishuHttpClient } from "../http-client.js";
import type { FeishuCalendarEvent, FeishuCalendarSyncData, SourceCheckpoint } from "../types.js";
import type { FeishuSource } from "./base.js";

export class CalendarSource implements FeishuSource {
  readonly name = "calendar";

  constructor(
    private readonly client: FeishuHttpClient,
    private readonly calendarIds: string[],
  ) {}

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    for (const calendarId of this.calendarIds) {
      try {
        yield* this.fetchCalendar(calendarId, checkpoint, cursorStaging);
      } catch (error) {
        console.error(`[CalendarSource] Failed to fetch calendar ${calendarId}:`, error);
      }
    }
  }

  private async *fetchCalendar(
    calendarId: string,
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    const path = `/open-apis/calendar/v4/calendars/${calendarId}/events`;
    const params: Record<string, string> = {};

    // The collector injects `lastCheckpoint["calendar"]` as this source's
    // checkpoint, so `checkpoint` IS already the per-calendar map
    // (Record<calendarId, { sync_token }>). Read at that level directly — an
    // extra `.calendar` deref would look for a calendar literally named
    // "calendar" and always miss, killing incremental sync.
    const calendarCheckpoint = checkpoint?.[calendarId] as { sync_token?: string } | undefined;
    if (calendarCheckpoint?.sync_token) {
      params.sync_token = calendarCheckpoint.sync_token;
    } else {
      const now = new Date();
      const startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const endTime = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      params.start_time = startTime.toISOString();
      params.end_time = endTime.toISOString();
    }

    let pageToken = "";
    let syncToken: string | undefined;

    do {
      const pageParams = pageToken ? { ...params, page_token: pageToken } : params;
      const res = await this.client.request<{ code: number; data: FeishuCalendarSyncData }>(
        "GET",
        path,
        { params: pageParams },
      );

      const data = res.data;

      for (const event of data.items) {
        yield this.eventToRawMessage(event, calendarId);
      }

      // sync_token arrives on the final page; keep the latest one seen.
      if (data.sync_token) syncToken = data.sync_token;

      pageToken = data.page_token ?? "";
      if (!data.has_more) break;
    } while (pageToken);

    if (syncToken) {
      cursorStaging.stage(this.name, calendarId, { sync_token: syncToken });
      cursorStaging.commit(this.name, calendarId);
    }
  }

  private eventToRawMessage(event: FeishuCalendarEvent, calendarId: string): RawMessage {
    let timestamp: string;
    if (event.start_time.timestamp) {
      timestamp = new Date(Number(event.start_time.timestamp) * 1000).toISOString();
    } else if (event.start_time.date) {
      timestamp = event.start_time.date;
    } else {
      timestamp = new Date().toISOString();
    }

    const parts: string[] = [];
    if (event.summary) parts.push(event.summary);
    if (event.description) parts.push(event.description);
    if (event.location?.name) parts.push(`地点: ${event.location.name}`);
    const content = parts.join("\n");

    const attendees =
      event.attendees?.map((a) => ({
        id: a.user_id ?? "unknown",
        name: a.display_name ?? "unknown",
        status: a.rsvp_status ?? "unknown",
      })) ?? [];

    const metadata: Record<string, unknown> = {
      event_id: event.event_id,
      end_time: event.end_time,
      location: event.location,
      attendees,
      status: event.status,
      calendar_id: calendarId,
    };

    if (event.recurrence) metadata.recurrence = event.recurrence;
    if (event.vchat?.meeting_url) metadata.meeting_url = event.vchat.meeting_url;

    return {
      platform: "feishu",
      channel: `calendar/${calendarId}`,
      contact: event.organizer?.open_id ?? "unknown",
      timestamp,
      content,
      direction: "received",
      metadata,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
