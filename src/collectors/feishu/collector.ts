import type { IdentityBackend } from "../../core/identity-resolver";
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
import { MailSource } from "./sources/mail";
import { MessageSource } from "./sources/messages";
import { TaskSource } from "./sources/tasks";
import type { FeishuCheckpoint, FeishuCollectorConfig } from "./types";

interface FeishuChatInfo {
  chat_id: string;
  chat_mode: string;
  name: string;
  owner_id?: string;
}

export class LarkCliIdentityBackend implements IdentityBackend {
  private memberCache = new Map<string, string>();
  private discoveredChats = new Set<string>();

  constructor(private readonly client: IFeishuHttpClient) {}

  async resolveFeishuOpenId(openId: string): Promise<{ name: string; slugHint?: string } | null> {
    if (this.memberCache.has(openId)) {
      return { name: this.memberCache.get(openId)! };
    }
    return null;
  }

  async warmCacheFromChats(chatIds: string[]): Promise<void> {
    for (const chatId of chatIds) {
      if (this.discoveredChats.has(chatId)) continue;
      this.discoveredChats.add(chatId);
      try {
        const res = await this.client.request<{
          code: number;
          data: { items: Array<{ member_id: string; name: string }> };
        }>("GET", `/open-apis/im/v1/chats/${chatId}/members`, {
          params: { member_id_type: "open_id" },
        });
        for (const member of res.data?.items ?? []) {
          if (member.name && member.member_id) {
            this.memberCache.set(member.member_id, member.name);
          }
        }
      } catch {
        /* non-critical */
      }
    }
  }
}

export class FeishuCollector implements Collector, CursorProvider {
  readonly id = "feishu";
  readonly name = "Feishu";
  readonly description = "Feishu Open API collector (messages, calendar, docs, tasks, dm, mail)";

  private readonly auth: FeishuAuthManager | null;
  private readonly client: IFeishuHttpClient;
  private readonly larkCliClient: LarkCliHttpClient | null;
  private readonly sources: FeishuSource[];
  private cursorStaging: CursorStaging;
  private lastCheckpoint: FeishuCheckpoint | null = null;
  private identityBackend: LarkCliIdentityBackend | null = null;

  constructor(config: FeishuCollectorConfig, chatIds: string[], selfOpenId?: string) {
    const isUserMode = config.auth_mode === "user";

    if (isUserMode) {
      this.auth = null;
      this.larkCliClient = new LarkCliHttpClient(config.lark_bin);
      this.client = this.larkCliClient;
      this.identityBackend = new LarkCliIdentityBackend(this.client);
    } else {
      this.auth = new FeishuAuthManager(config.app_id, config.app_secret, config.base_url);
      this.larkCliClient = null;
      const rateLimiter = new FeishuRateLimiter(config.rate_limit_qps);
      this.client = new FeishuHttpClient(this.auth, rateLimiter);
    }

    this.cursorStaging = new CursorStaging();
    this.sources = [];

    if (config.sources.messages?.enabled) {
      const msgChatIds = config.sources.messages.chat_ids ?? chatIds;
      this.sources.push(
        new MessageSource(this.client, msgChatIds, {
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
          selfOpenId: config.sources.dm.self_open_id ?? selfOpenId,
          overlapMs: config.sources.dm.overlap_ms,
        }),
      );
    }

    if (config.sources.mail?.enabled) {
      if (!this.larkCliClient) {
        console.warn("feishu: mail source requires auth_mode=user (lark-cli), skipping");
      } else {
        this.sources.push(
          new MailSource(this.larkCliClient, {
            lookbackDays: config.sources.mail.lookback_days ?? 30,
            overlapMs: config.sources.mail.overlap_ms,
          }),
        );
      }
    }
  }

  getIdentityBackend(): IdentityBackend | undefined {
    return this.identityBackend ?? undefined;
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

export async function createFeishuCollector(
  config: FeishuCollectorConfig,
): Promise<FeishuCollector> {
  let chatIds: string[] = [];
  let selfOpenId: string | undefined;

  if (config.auth_mode === "user") {
    const client = new LarkCliHttpClient(config.lark_bin);

    // Auto-discover chats if not explicitly configured
    if (!config.sources.messages?.chat_ids?.length) {
      try {
        const res = await client.request<{
          code: number;
          data: { items: FeishuChatInfo[] };
        }>("GET", "/open-apis/im/v1/chats", { params: { page_size: "100" } });

        chatIds = res.data.items.map((c) => c.chat_id);
        console.log(`feishu: auto-discovered ${chatIds.length} chats`);
      } catch (err) {
        console.warn("feishu: chat auto-discovery failed, using configured chat_ids", err);
      }
    }

    // Get self open_id for DM direction detection
    try {
      const status = await client.request<{ userOpenId?: string }>(
        "GET",
        "/open-apis/authen/v1/user_info",
        {},
      );
      selfOpenId = (status as Record<string, unknown>).userOpenId as string | undefined;
    } catch {
      // lark auth status is not an API call — parse from healthCheck
      try {
        const stdout = await client.execShortcut("auth", "status");
        const parsed = JSON.parse(stdout) as { userOpenId?: string };
        selfOpenId = parsed.userOpenId;
      } catch {
        /* non-critical */
      }
    }
  }

  const collector = new FeishuCollector(config, chatIds, selfOpenId);

  // Warm identity cache from discovered chats
  const backend = collector.getIdentityBackend();
  if (backend instanceof LarkCliIdentityBackend && chatIds.length > 0) {
    await backend.warmCacheFromChats(chatIds);
    console.log(`feishu: identity cache warmed from ${chatIds.length} chats`);
  }

  return collector;
}
