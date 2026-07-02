import { pMap } from "../../../core/concurrency.js";
import type { RawMessage } from "../../../core/types.js";
import type { CursorStaging } from "../cursor-staging.js";
import type { LarkCliHttpClient } from "../lark-cli-client.js";
import type { FeishuMailMessage, SourceCheckpoint } from "../types.js";
import type { FeishuSource } from "./base.js";

interface MailSourceOpts {
  lookbackDays: number;
  overrideSinceMs?: number;
  overlapMs?: number;
  fetchConcurrency?: number;
}

interface TriageItem {
  message_id: string;
  date: string;
  from: string;
  subject: string;
  thread_id?: string;
}

export class MailSource implements FeishuSource {
  readonly name = "mail";
  private readonly overlapMs: number;

  constructor(
    private readonly client: LarkCliHttpClient,
    private readonly opts: MailSourceOpts,
  ) {
    this.overlapMs = opts.overlapMs ?? 2000;
  }

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    // fetchTriage errors (auth scope missing, 4013 user-not-found, etc.) must
    // propagate so the collector / pipeline can surface them as a real source
    // failure instead of silently reporting 0 messages.
    const startMs = this.resolveStartTime(checkpoint);
    const triageItems = await this.fetchTriage();

    const filteredItems = triageItems.filter(
      (item) => new Date(item.date).getTime() >= startMs - this.overlapMs,
    );

    const concurrency = this.opts.fetchConcurrency ?? 1;
    let maxDateMs = 0;
    let oldestFailedMs = Number.POSITIVE_INFINITY;

    for await (const { item, detail } of this.fetchConcurrent(filteredItems, concurrency)) {
      const itemDateMs = new Date(item.date).getTime();
      if (!detail) {
        // A transient detail-fetch failure (rate limit, timeout, etc.) must not
        // be lost. Track the oldest failure so we can clamp the committed cursor
        // below it — the next run's window will re-include this message. The
        // dedup store skips the successfully-ingested newer messages as
        // "unchanged" (identity is per-message via metadata.message_id).
        if (itemDateMs < oldestFailedMs) oldestFailedMs = itemDateMs;
        continue;
      }
      if (itemDateMs > maxDateMs) maxDateMs = itemDateMs;
      yield this.mapMessage(item, detail);
    }

    // Clamp the high-water-mark so it never advances past the oldest failed
    // message. If every processed item failed, do not advance the cursor at all.
    let committedMs = maxDateMs;
    if (oldestFailedMs !== Number.POSITIVE_INFINITY) {
      committedMs = Math.min(committedMs, oldestFailedMs - 1);
    }

    if (committedMs > 0) {
      cursorStaging.stage("mail", "INBOX", { last_sync_at: committedMs });
      cursorStaging.commit("mail", "INBOX");
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private async *fetchConcurrent(
    items: TriageItem[],
    concurrency: number,
  ): AsyncGenerator<{ item: TriageItem; detail: FeishuMailMessage | null }> {
    const results = await pMap(
      items,
      async (item) => ({ item, detail: await this.fetchMessage(item.message_id) }),
      concurrency,
    );
    for (const pair of results) {
      yield pair;
    }
  }

  private resolveStartTime(checkpoint: SourceCheckpoint | null): number {
    const checkpointMs = checkpoint?.INBOX?.last_sync_at as number | undefined;
    if (
      this.opts.overrideSinceMs !== undefined &&
      (checkpointMs === undefined || this.opts.overrideSinceMs < checkpointMs)
    ) {
      return this.opts.overrideSinceMs;
    }
    if (checkpointMs !== undefined) return checkpointMs;
    return Date.now() - this.opts.lookbackDays * 24 * 60 * 60 * 1000;
  }

  private async fetchTriage(): Promise<TriageItem[]> {
    const stdout = await this.client.execShortcut("mail", "triage", [
      "--filter",
      '{"folder":"INBOX"}',
    ]);
    try {
      const parsed = JSON.parse(stdout);
      if (parsed && Array.isArray(parsed.messages)) {
        return parsed.messages as TriageItem[];
      }
      if (Array.isArray(parsed)) {
        return parsed as TriageItem[];
      }
      return [];
    } catch {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const items: TriageItem[] = [];
      for (const line of lines) {
        if (line.startsWith("[")) continue;
        try {
          const obj = JSON.parse(line);
          if (obj && Array.isArray(obj.messages)) {
            items.push(...(obj.messages as TriageItem[]));
          } else {
            items.push(obj as TriageItem);
          }
        } catch {}
      }
      return items;
    }
  }

  private async fetchMessage(messageId: string): Promise<FeishuMailMessage | null> {
    try {
      const stdout = await this.client.execShortcut("mail", "message", [
        "--message-id",
        messageId,
        "--html=false",
      ]);
      const parsed = JSON.parse(stdout);
      const raw = parsed?.data ?? parsed;
      if (raw.body_plain_text !== undefined && raw.body === undefined) {
        raw.body = raw.body_plain_text;
      }
      return raw as FeishuMailMessage;
    } catch (err) {
      console.error(`[MailSource] Failed to fetch message ${messageId}:`, err);
      return null;
    }
  }

  private mapMessage(triage: TriageItem, detail: FeishuMailMessage): RawMessage {
    const subject = detail.subject || triage.subject || "";
    const body = detail.body || "";
    const content = subject ? `${subject}\n\n${body}` : body;

    return {
      platform: "feishu",
      channel: "mail/INBOX",
      contact: triage.from || detail.from || "",
      timestamp: new Date(triage.date).toISOString(),
      content,
      direction: "received",
      metadata: {
        message_id: triage.message_id,
        thread_id: triage.thread_id || detail.thread_id || null,
        to: detail.to || [],
        cc: detail.cc || [],
        has_attachments: (detail.attachments?.length ?? 0) > 0,
        sensitivity: "high",
      },
      attachments: detail.attachments?.map((a) => ({
        id: a.file_name,
        type: "file",
        name: a.file_name,
      })),
    };
  }
}
