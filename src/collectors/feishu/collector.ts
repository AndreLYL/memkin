import type { Collector, CursorProvider, FetchOpts, RawMessage } from "../../core/types.js";
import { FeishuAuthManager } from "./auth.js";
import { CursorStaging } from "./cursor-staging.js";
import { FeishuHttpClient } from "./http-client.js";
import { LarkCliHttpClient } from "./lark-cli-client.js";
import { FeishuRateLimiter } from "./rate-limiter.js";
import type { FeishuSource } from "./sources/base.js";
import { CalendarSource } from "./sources/calendar.js";
import { DMSource } from "./sources/dm.js";
import { DocSource } from "./sources/docs.js";
import { MailSource } from "./sources/mail.js";
import { MessageSearchSource } from "./sources/message-search.js";
import { MessageSource } from "./sources/messages.js";
import { TaskSource } from "./sources/tasks.js";
import type { FeishuCheckpoint, FeishuCollectorConfig } from "./types.js";

export class FeishuCollector implements Collector, CursorProvider {
  readonly id = "feishu";
  readonly name = "Feishu";
  readonly description = "Feishu Open API collector (messages, calendar, docs, tasks, dm, mail)";

  private readonly auth: FeishuAuthManager;
  private readonly client: FeishuHttpClient;
  private readonly sources: FeishuSource[];
  private cursorStaging: CursorStaging;
  private lastCheckpoint: FeishuCheckpoint | null = null;

  constructor(config: FeishuCollectorConfig) {
    this.auth = new FeishuAuthManager(config.app_id, config.app_secret, config.base_url);
    const rateLimiter = new FeishuRateLimiter(config.rate_limit_qps);
    this.client = new FeishuHttpClient(this.auth, rateLimiter);
    this.cursorStaging = new CursorStaging();
    this.sources = [];

    if (config.sources.messages?.enabled) {
      this.sources.push(
        new MessageSource(this.client, config.sources.messages.chat_ids ?? [], {
          lookbackDays: config.sources.messages.lookback_days ?? 30,
          overrideSinceMs: config.sources.messages.override_since_ms,
          overlapMs: config.sources.messages.overlap_ms,
        }),
      );
    }

    if (config.sources.calendar?.enabled) {
      this.sources.push(new CalendarSource(this.client, config.sources.calendar.calendar_ids));
    }

    if (config.sources.docs?.enabled) {
      this.sources.push(new DocSource(this.client, config.sources.docs));
    }

    if (config.sources.tasks?.enabled) {
      this.sources.push(new TaskSource(this.client));
    }

    if (config.sources.dm?.enabled) {
      this.sources.push(
        new DMSource(this.client, config.sources.dm.dm_chat_ids ?? [], {
          lookbackDays: config.sources.dm.lookback_days ?? 30,
          overrideSinceMs: config.sources.dm.override_since_ms,
          selfOpenId: config.sources.dm.self_open_id ?? "",
          overlapMs: config.sources.dm.overlap_ms,
        }),
      );
    }

    if (config.sources.mail?.enabled) {
      const larkClient = new LarkCliHttpClient(config.lark_bin);
      this.sources.push(
        new MailSource(larkClient, {
          lookbackDays: config.sources.mail.lookback_days ?? 30,
          overrideSinceMs: config.sources.mail.override_since_ms,
          overlapMs: config.sources.mail.overlap_ms,
          fetchConcurrency: config.sources.mail.fetch_concurrency,
        }),
      );
    }

    if (config.sources.message_search?.enabled) {
      const larkClient = new LarkCliHttpClient(config.lark_bin);
      this.sources.push(
        new MessageSearchSource(larkClient, {
          chatTypes: config.sources.message_search.chat_types ?? ["p2p", "group"],
          lookbackDays: config.sources.message_search.lookback_days ?? 30,
          overrideSinceMs: config.sources.message_search.override_since_ms,
          query: config.sources.message_search.query,
          senderType: config.sources.message_search.sender_type,
          excludeSenderType: config.sources.message_search.exclude_sender_type,
          overlapMs: config.sources.message_search.overlap_ms,
          pageSize: config.sources.message_search.page_size,
        }),
      );
    }
  }

  setCheckpoint(checkpoint: FeishuCheckpoint | null): void {
    this.lastCheckpoint = checkpoint;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.auth.getToken();
      return { ok: true, message: `${this.sources.length} source(s) enabled` };
    } catch (err) {
      return {
        ok: false,
        message: `Auth failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async *fetch(_opts: FetchOpts): AsyncGenerator<RawMessage> {
    this.cursorStaging = new CursorStaging();

    for (const source of this.sources) {
      try {
        const sourceCheckpoint =
          this.lastCheckpoint?.[source.name as keyof FeishuCheckpoint] ?? null;
        yield* source.fetch(sourceCheckpoint, this.cursorStaging);
      } catch (err) {
        console.error(`feishu: source=${source.name} fatal error:`, err);
        this.cursorStaging.discardSource(source.name);
      }
    }
  }

  getCommittableCursors(): Record<string, unknown> {
    return this.cursorStaging.getCommittable();
  }

  discardSource(sourceName: string): void {
    this.cursorStaging.discardSource(sourceName);
  }
}

export function createFeishuCollector(config: FeishuCollectorConfig): FeishuCollector {
  return new FeishuCollector(config);
}
