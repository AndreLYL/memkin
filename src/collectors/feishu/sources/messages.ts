import type { RawMessage } from "../../../core/types.js";
import type { CursorStaging } from "../cursor-staging.js";
import type { FeishuHttpClient } from "../http-client.js";
import type { FeishuMessage, SourceCheckpoint } from "../types.js";
import type { FeishuSource } from "./base.js";

interface MessageSourceOpts {
  lookbackDays: number;
  overlapMs?: number;
}

export class MessageSource implements FeishuSource {
  readonly name = "messages";
  private readonly overlapMs: number;

  constructor(
    private readonly client: FeishuHttpClient,
    private readonly chatIds: string[],
    private readonly opts: MessageSourceOpts,
  ) {
    this.overlapMs = opts.overlapMs ?? 2000;
  }

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    for (const chatId of this.chatIds) {
      try {
        const startMs = this.resolveStartTime(checkpoint, chatId);
        const endMs = Date.now();
        const startSec = Math.floor((startMs - this.overlapMs) / 1000).toString();
        const endSec = Math.floor(endMs / 1000).toString();

        let maxCreateTime = 0;

        for await (const page of this.client.paginate<FeishuMessage>("/open-apis/im/v1/messages", {
          container_id_type: "chat",
          container_id: chatId,
          start_time: startSec,
          end_time: endSec,
        })) {
          for (const msg of page.items) {
            const createTimeMs = Number.parseInt(msg.create_time, 10);
            if (createTimeMs > maxCreateTime) {
              maxCreateTime = createTimeMs;
            }

            yield this.mapMessage(msg, chatId);
          }
        }

        if (maxCreateTime > 0) {
          // Stage only — the pipeline commits this cursor after confirming ingestion.
          cursorStaging.stage("messages", chatId, { last_sync_at: maxCreateTime });
        }
      } catch (err) {
        console.error(`[MessageSource] Failed to fetch chat ${chatId}:`, err);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private resolveStartTime(checkpoint: SourceCheckpoint | null, chatId: string): number {
    if (checkpoint?.[chatId]?.last_sync_at) {
      return checkpoint[chatId].last_sync_at as number;
    }
    const lookbackMs = this.opts.lookbackDays * 24 * 60 * 60 * 1000;
    return Date.now() - lookbackMs;
  }

  private mapMessage(msg: FeishuMessage, chatId: string): RawMessage {
    const content = this.parseContent(msg);
    const attachments = this.extractAttachments(msg);

    return {
      platform: "feishu",
      channel: `group/${chatId}`,
      contact: msg.sender.id,
      timestamp: new Date(Number.parseInt(msg.create_time, 10)).toISOString(),
      content,
      direction: "received",
      metadata: {
        message_id: msg.message_id,
        root_id: msg.root_id || null,
        parent_id: msg.parent_id || null,
        msg_type: msg.msg_type,
        mentions: msg.mentions || [],
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  private parseContent(msg: FeishuMessage): string {
    const raw = msg.body?.content;
    if (!raw) return "";

    try {
      const parsed = JSON.parse(raw);

      switch (msg.msg_type) {
        case "text":
          return parsed.text || "";

        case "post": {
          const contentObj = parsed.content;
          if (!contentObj) return parsed.title || "";

          const texts: string[] = [];
          if (parsed.title) texts.push(parsed.title);
          for (const block of Object.values(contentObj).flat() as unknown[][]) {
            if (Array.isArray(block)) {
              for (const node of block) {
                if ((node as Record<string, unknown>).text)
                  texts.push((node as Record<string, unknown>).text as string);
              }
            }
          }
          return texts.join(" ");
        }

        case "image":
          return "[图片]";

        case "file":
          return parsed.file_name ? `[文件: ${parsed.file_name}]` : "[文件]";

        case "interactive": {
          const header = parsed.config?.wide_screen_mode?.header;
          if (header?.title?.content) {
            return header.title.content;
          }
          return "[卡片消息]";
        }

        default:
          return raw;
      }
    } catch {
      return raw;
    }
  }

  private extractAttachments(
    msg: FeishuMessage,
  ): Array<{ id: string; type: string; name?: string }> {
    const attachments: Array<{ id: string; type: string; name?: string }> = [];
    const raw = msg.body?.content;
    if (!raw) return attachments;

    try {
      const parsed = JSON.parse(raw);

      if (msg.msg_type === "image" && parsed.image_key) {
        attachments.push({
          id: parsed.image_key,
          type: "image",
        });
      }

      if (msg.msg_type === "file" && parsed.file_key) {
        attachments.push({
          id: parsed.file_key,
          type: "file",
          name: parsed.file_name,
        });
      }
    } catch {}

    return attachments;
  }
}
