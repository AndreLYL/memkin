import type { RawMessage } from "../../../core/types";
import type { CursorStaging } from "../cursor-staging";
import type { LarkCliHttpClient } from "../lark-cli-client";
import type { FeishuMailMessage, SourceCheckpoint } from "../types";
import type { FeishuSource } from "./base";

interface MailSourceOpts {
  lookbackDays: number;
  overlapMs?: number;
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
    try {
      const startMs = this.resolveStartTime(checkpoint);
      const triageItems = await this.fetchTriage();

      let maxDateMs = 0;

      for (const item of triageItems) {
        const itemDateMs = new Date(item.date).getTime();
        if (itemDateMs < startMs - this.overlapMs) continue;

        const detail = await this.fetchMessage(item.message_id);
        if (!detail) continue;

        if (itemDateMs > maxDateMs) maxDateMs = itemDateMs;

        yield this.mapMessage(item, detail);
      }

      if (maxDateMs > 0) {
        cursorStaging.stage("mail", "INBOX", { last_sync_at: maxDateMs });
        cursorStaging.commit("mail", "INBOX");
      }
    } catch (err) {
      console.error("[MailSource] Failed to fetch mail:", err);
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private resolveStartTime(checkpoint: SourceCheckpoint | null): number {
    if (checkpoint?.INBOX?.last_sync_at) {
      return checkpoint.INBOX.last_sync_at as number;
    }
    const lookbackMs = this.opts.lookbackDays * 24 * 60 * 60 * 1000;
    return Date.now() - lookbackMs;
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
        "--html",
        "false",
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
