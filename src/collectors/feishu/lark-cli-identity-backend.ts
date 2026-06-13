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

interface ChatMember {
  member_id?: string;
  member_id_type?: string;
  name?: string;
}

interface ChatMembersResponse {
  code: number;
  data?: { items?: ChatMember[] };
}

interface MessageSender {
  id?: string;
  id_type?: string;
  name?: string;
  sender_type?: string;
}

interface Message {
  sender?: MessageSender;
}

interface ChatMessagesListResponse {
  ok?: boolean;
  data?: { items?: Message[] };
}

interface ParsedChannel {
  kind: "group" | "dm" | "mail";
  chatId: string;
}

export class LarkCliIdentityBackend implements IdentityBackend {
  constructor(
    private readonly client: LarkCliHttpClient,
    private readonly selfOpenId?: string,
  ) {}

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

    if (info.chat_mode === "p2p") {
      return this.resolveP2P(parsed.chatId);
    }

    return null;
  }

  private async resolveP2P(chatId: string): Promise<{ name: string } | null> {
    if (!this.selfOpenId) return null;

    const fromMembers = await this.findCounterpartyFromMembers(chatId);
    if (fromMembers) return { name: `💬 ${fromMembers}` };

    const fromMessages = await this.findCounterpartyFromMessages(chatId);
    if (fromMessages) return { name: `💬 ${fromMessages}` };

    return null;
  }

  private async findCounterpartyFromMembers(chatId: string): Promise<string | null> {
    try {
      const resp = await this.client.request<ChatMembersResponse>(
        "GET",
        `/open-apis/im/v1/chats/${chatId}/members`,
      );
      if (resp.code !== 0) return null;
      const items = resp.data?.items ?? [];
      const other = items.find(
        (m) => m.member_id !== this.selfOpenId && m.member_id_type === "open_id" && m.name,
      );
      return other?.name ?? null;
    } catch {
      return null;
    }
  }

  private async findCounterpartyFromMessages(chatId: string): Promise<string | null> {
    try {
      const stdout = await this.client.execShortcut("im", "chat-messages-list", [
        "--chat-id",
        chatId,
        "--page-size",
        "20",
        "--sort",
        "desc",
      ]);
      const parsed = JSON.parse(stdout) as ChatMessagesListResponse;
      const items = parsed.data?.items ?? [];
      const msg = items.find(
        (m) => m.sender?.sender_type === "user" && m.sender.id !== this.selfOpenId && m.sender.name,
      );
      return msg?.sender?.name ?? null;
    } catch {
      return null;
    }
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
