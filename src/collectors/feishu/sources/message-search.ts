import type { RawMessage } from "../../../core/types.js";
import type { CursorStaging } from "../cursor-staging.js";
import type { LarkCliHttpClient } from "../lark-cli-client.js";
import type { SourceCheckpoint } from "../types.js";
import type { FeishuSource } from "./base.js";

type SearchChatType = "p2p" | "group";

interface MessageSearchOpts {
  chatTypes: SearchChatType[];
  lookbackDays: number;
  selfOpenId?: string;
  query?: string;
  senderType?: "user" | "bot";
  excludeSenderType?: "user" | "bot";
  pageSize?: number;
  overlapMs?: number;
  maxRetries?: number;
}

interface SearchMessage {
  chat_id: string;
  chat_name?: string;
  chat_partner?: { open_id?: string };
  chat_type: SearchChatType;
  content: string;
  create_time: string;
  deleted?: boolean;
  message_id: string;
  msg_type: string;
  reply_to?: string;
  sender: {
    id: string;
    id_type: string;
    name?: string;
    sender_type: string;
    tenant_key?: string;
  };
  updated?: boolean;
}

interface SearchResponse {
  ok: boolean;
  data?: {
    has_more?: boolean;
    messages?: SearchMessage[];
    page_token?: string;
    total?: number;
  };
  error?: { message?: string };
}

export class MessageSearchSource implements FeishuSource {
  readonly name = "message_search";
  private readonly overlapMs: number;
  private readonly pageSize: number;
  private readonly maxRetries: number;

  constructor(
    private readonly client: LarkCliHttpClient,
    private readonly opts: MessageSearchOpts,
  ) {
    this.overlapMs = opts.overlapMs ?? 2000;
    this.pageSize = opts.pageSize ?? 50;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    for (const chatType of this.opts.chatTypes) {
      try {
        const startMs = this.resolveStartTime(checkpoint, chatType);
        const endMs = Date.now();
        let maxCreateTime = 0;
        let pageToken = "";

        do {
          const response = await this.fetchPage(chatType, startMs, endMs, pageToken);
          const messages = response.data?.messages ?? [];

          for (const msg of messages) {
            if (msg.deleted) continue;

            const createTimeMs = this.parseCreateTime(msg.create_time);
            if (createTimeMs < startMs - this.overlapMs) continue;
            if (createTimeMs > maxCreateTime) maxCreateTime = createTimeMs;

            yield this.mapMessage(msg, createTimeMs);
          }

          pageToken = response.data?.page_token ?? "";
          if (!response.data?.has_more) break;
        } while (pageToken);

        if (maxCreateTime > 0) {
          cursorStaging.stage(this.name, chatType, { last_sync_at: maxCreateTime });
          cursorStaging.commit(this.name, chatType);
        }
      } catch (err) {
        console.error(`[MessageSearchSource] Failed to fetch ${chatType} messages:`, err);
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private resolveStartTime(checkpoint: SourceCheckpoint | null, chatType: SearchChatType): number {
    if (checkpoint?.[chatType]?.last_sync_at) {
      return checkpoint[chatType].last_sync_at as number;
    }
    const lookbackMs = this.opts.lookbackDays * 24 * 60 * 60 * 1000;
    return Date.now() - lookbackMs;
  }

  private async fetchPage(
    chatType: SearchChatType,
    startMs: number,
    endMs: number,
    pageToken: string,
  ): Promise<SearchResponse> {
    const flags = [
      "--chat-type",
      chatType,
      "--start",
      this.toFeishuSearchTime(startMs - this.overlapMs),
      "--end",
      this.toFeishuSearchTime(endMs),
      "--page-size",
      String(this.pageSize),
    ];

    if (this.opts.query) flags.push("--query", this.opts.query);
    if (this.opts.senderType) flags.push("--sender-type", this.opts.senderType);
    if (this.opts.excludeSenderType)
      flags.push("--exclude-sender-type", this.opts.excludeSenderType);
    if (pageToken) flags.push("--page-token", pageToken);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const stdout = await this.client.execShortcut("im", "messages-search", flags);
        const response = JSON.parse(stdout) as SearchResponse;
        if (!response.ok) {
          throw new Error(response.error?.message ?? "messages-search failed");
        }
        return response;
      } catch (err) {
        lastError = err;
        if (attempt === this.maxRetries) break;
        await this.sleep(500 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  private mapMessage(msg: SearchMessage, createTimeMs: number): RawMessage {
    const isSelf = msg.sender.id === this.opts.selfOpenId;
    return {
      platform: "feishu",
      channel: `${msg.chat_type === "p2p" ? "dm" : "group"}/${msg.chat_id}`,
      contact: msg.sender.name || msg.sender.id,
      timestamp: new Date(createTimeMs).toISOString(),
      content: msg.content || "",
      direction: isSelf ? "sent" : "received",
      metadata: {
        message_id: msg.message_id,
        root_id: null,
        parent_id: msg.reply_to || null,
        msg_type: msg.msg_type,
        chat_type: msg.chat_type,
        chat_name: msg.chat_name || null,
        chat_partner: msg.chat_partner || null,
        sender: msg.sender,
        updated: msg.updated ?? false,
        sensitivity: msg.chat_type === "p2p" ? "high" : undefined,
      },
    };
  }

  private parseCreateTime(value: string): number {
    if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
    if (value.includes("T")) return new Date(value).getTime();
    return new Date(`${value.replace(" ", "T")}:00+08:00`).getTime();
  }

  private toFeishuSearchTime(ms: number): string {
    const date = new Date(ms);
    const offsetMs = 8 * 60 * 60 * 1000;
    const local = new Date(date.getTime() + offsetMs);
    return `${local.toISOString().slice(0, 19)}+08:00`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
