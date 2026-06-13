import { describe, expect, it, vi } from "vitest";
import type { LarkCliHttpClient } from "./lark-cli-client.js";
import { LarkCliIdentityBackend } from "./lark-cli-identity-backend.js";

/**
 * Mock LarkCliHttpClient with two stub maps:
 *  - requestStubs:    key = `${method} ${path}` → response body or thrown Error
 *  - shortcutStubs:   key = `${domain}/${shortcut}/${flags.join(' ')}` → stdout string
 *
 * The backend should only need `request` for Task 3 (group path). `execShortcut`
 * is here so future p2p-fallback tests (Task 4) can reuse this helper.
 */
function makeMockClient(
  requestStubs: Record<string, unknown> = {},
  shortcutStubs: Record<string, string> = {},
): LarkCliHttpClient {
  return {
    request: vi.fn(async (method: string, path: string) => {
      const key = `${method} ${path}`;
      const value = requestStubs[key];
      if (value === undefined) throw new Error(`no stub for: ${key}`);
      if (value instanceof Error) throw value;
      return value;
    }),
    execShortcut: vi.fn(async (domain: string, shortcut: string, flags?: string[]) => {
      const key = `${domain}/${shortcut}/${(flags ?? []).join(" ")}`;
      const value = shortcutStubs[key];
      if (value === undefined) throw new Error(`no stub for: ${key}`);
      return value;
    }),
  } as unknown as LarkCliHttpClient;
}

describe("LarkCliIdentityBackend.resolveFeishuChatId — group path", () => {
  it("returns group name for group channel", async () => {
    const client = makeMockClient({
      "GET /open-apis/im/v1/chats/oc_grp123": {
        code: 0,
        data: { chat_mode: "group", name: "产品讨论" },
      },
    });
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("group/oc_grp123");
    expect(result).toEqual({ name: "产品讨论" });
  });

  it("returns null for mail channel WITHOUT calling lark-cli", async () => {
    const requestSpy = vi.fn();
    const shortcutSpy = vi.fn();
    const client = {
      request: requestSpy,
      execShortcut: shortcutSpy,
    } as unknown as LarkCliHttpClient;
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("mail/INBOX");
    expect(result).toBeNull();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(shortcutSpy).not.toHaveBeenCalled();
  });

  it("returns null when API returns non-zero code (any reason)", async () => {
    const client = makeMockClient({
      "GET /open-apis/im/v1/chats/oc_forbidden": { code: 230002, msg: "forbidden" },
    });
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("group/oc_forbidden");
    expect(result).toBeNull();
  });

  it("returns null when group chat name is empty (defensive)", async () => {
    const client = makeMockClient({
      "GET /open-apis/im/v1/chats/oc_anon": { code: 0, data: { chat_mode: "group", name: "" } },
    });
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("group/oc_anon");
    expect(result).toBeNull();
  });

  it("returns null when chat_mode is something other than group/p2p", async () => {
    const client = makeMockClient({
      "GET /open-apis/im/v1/chats/oc_topic": {
        code: 0,
        data: { chat_mode: "topic", name: "话题" },
      },
    });
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("group/oc_topic");
    expect(result).toBeNull();
  });

  it("returns null when channel string is malformed", async () => {
    const client = makeMockClient({});
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("not-a-real-channel");
    expect(result).toBeNull();
  });

  it("returns null when chats get throws (network error)", async () => {
    const client = makeMockClient({
      "GET /open-apis/im/v1/chats/oc_netfail": new Error("network timeout"),
    });
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("group/oc_netfail");
    expect(result).toBeNull();
  });

  it("returns null when chatId is empty after the prefix", async () => {
    const requestSpy = vi.fn();
    const client = { request: requestSpy, execShortcut: vi.fn() } as unknown as LarkCliHttpClient;
    const backend = new LarkCliIdentityBackend(client);
    expect(await backend.resolveFeishuChatId("group/")).toBeNull();
    expect(await backend.resolveFeishuChatId("dm/")).toBeNull();
    expect(await backend.resolveFeishuChatId("mail/")).toBeNull();
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

// TODO: Task 4 — remove or replace this describe block when p2p resolution lands
describe("LarkCliIdentityBackend.resolveFeishuChatId — p2p stub (Task 4 will fill this in)", () => {
  it("returns null for p2p path until Task 4 implements it", async () => {
    const client = makeMockClient({
      "GET /open-apis/im/v1/chats/oc_p2p": { code: 0, data: { chat_mode: "p2p", name: "" } },
    });
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuChatId("dm/oc_p2p");
    expect(result).toBeNull();
  });
});

describe("LarkCliIdentityBackend.resolveFeishuOpenId — stub for now", () => {
  it("returns null (person resolution path not yet wired through this backend)", async () => {
    const client = makeMockClient({});
    const backend = new LarkCliIdentityBackend(client);
    const result = await backend.resolveFeishuOpenId("ou_xxx");
    expect(result).toBeNull();
  });
});
