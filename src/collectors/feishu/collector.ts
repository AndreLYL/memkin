import type { Collector, CursorProvider, FetchOpts, RawMessage } from "../../core/types";
import { FeishuAuthManager } from "./auth";
import { CursorStaging } from "./cursor-staging";
import type { IFeishuHttpClient } from "./http-client";
import { FeishuHttpClient } from "./http-client";
import { LarkCliHttpClient } from "./lark-cli-client";
import { FeishuRateLimiter } from "./rate-limiter";
import type { FeishuSource } from "./sources/base";
import { CalendarSource } from "./sources/calendar";
import { DMSource } from "./sources/dm";
import { DocSource } from "./sources/docs";
import { MessageSource } from "./sources/messages";
import { TaskSource } from "./sources/tasks";
import type { FeishuCheckpoint, FeishuCollectorConfig } from "./types";

export class FeishuCollector implements Collector, CursorProvider {
  readonly id = "feishu";
  readonly name = "Feishu";
  readonly description = "Feishu Open API collector (messages, calendar, docs, tasks, dm)";

  private readonly auth: FeishuAuthManager | null;
  private readonly client: IFeishuHttpClient;
  private readonly larkCliClient: LarkCliHttpClient | null;
  private readonly sources: FeishuSource[];
  private cursorStaging: CursorStaging;
  private lastCheckpoint: FeishuCheckpoint | null = null;

  constructor(config: FeishuCollectorConfig) {
    const isUserMode = config.auth_mode === "user";

    if (isUserMode) {
      this.auth = null;
      this.larkCliClient = new LarkCliHttpClient(config.lark_bin);
      this.client = this.larkCliClient;
    } else {
      this.auth = new FeishuAuthManager(config.app_id, config.app_secret, config.base_url);
      this.larkCliClient = null;
      const rateLimiter = new FeishuRateLimiter(config.rate_limit_qps);
      this.client = new FeishuHttpClient(this.auth, rateLimiter);
    }

    this.cursorStaging = new CursorStaging();
    this.sources = [];

    if (config.sources.messages?.enabled) {
      this.sources.push(
        new MessageSource(this.client, config.sources.messages.chat_ids, {
          lookbackDays: config.sources.messages.lookback_days ?? 30,
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
        new DMSource(this.client, config.sources.dm.dm_chat_ids, {
          lookbackDays: config.sources.dm.lookback_days ?? 30,
          selfOpenId: config.sources.dm.self_open_id,
          overlapMs: config.sources.dm.overlap_ms,
        }),
      );
    }
  }

  setCheckpoint(checkpoint: FeishuCheckpoint | null): void {
    this.lastCheckpoint = checkpoint;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      if (this.larkCliClient) {
        return await this.larkCliClient.healthCheck();
      }
      await this.auth?.getToken();
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
