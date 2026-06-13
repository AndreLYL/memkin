import type { IdentityBackend } from "../../core/identity-resolver.js";
import type { LarkCliHttpClient } from "./lark-cli-client.js";

interface ChatInfo {
  /** Known values: "group", "p2p". Unknown values are treated as unresolvable. */
  chat_mode?: string;
  name?: string;
}

interface ChatGetResponse {
  code: number;
  msg?: string;
  data?: ChatInfo;
}

interface ParsedChannel {
  kind: "group" | "dm" | "mail";
  chatId: string;
}

export class LarkCliIdentityBackend implements IdentityBackend {
  constructor(private readonly client: LarkCliHttpClient) {}

  /**
   * Person open_id → name. Task 3 leaves this as a stub returning null;
   * the live person-resolution path stays on the existing IdentityResolver
   * cache flow until a future task explicitly wires it through here.
   */
  async resolveFeishuOpenId(_openId: string) {
    return null;
  }

  /**
   * Channel string → display name.
   * - mail channels: short-circuit to null without any lark-cli call.
   * - group: GET /open-apis/im/v1/chats/{chat_id}, return data.name.
   * - p2p: Task 4 will land the algorithm; returns null for now.
   * Any non-zero response code, missing field, or thrown error returns null.
   */
  async resolveFeishuChatId(channel: string): Promise<{ name: string } | null> {
    const parsed = parseChannel(channel);
    if (!parsed) return null;
    if (parsed.kind === "mail") return null;

    const info = await this.getChatInfo(parsed.chatId);
    if (!info) return null;

    if (info.chat_mode === "group") {
      return info.name ? { name: info.name } : null;
    }

    // p2p and anything unexpected: defer to Task 4 / treat as unresolvable
    return null;
  }

  private async getChatInfo(chatId: string): Promise<ChatInfo | null> {
    try {
      const resp = await this.client.request<ChatGetResponse>(
        "GET",
        `/open-apis/im/v1/chats/${chatId}`,
      );
      if (resp.code !== 0) return null;
      return resp.data ?? null;
    } catch {
      return null;
    }
  }
}

function parseChannel(channel: string): ParsedChannel | null {
  if (channel.startsWith("group/")) {
    const chatId = channel.slice("group/".length);
    return chatId ? { kind: "group", chatId } : null;
  }
  if (channel.startsWith("dm/")) {
    const chatId = channel.slice("dm/".length);
    return chatId ? { kind: "dm", chatId } : null;
  }
  if (channel.startsWith("mail/")) {
    const chatId = channel.slice("mail/".length);
    return chatId ? { kind: "mail", chatId } : null;
  }
  return null;
}
