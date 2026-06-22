import { describe, expect, it } from "vitest";
import {
  setChatIds,
  toggleFeishuSubSource,
  toggleTopSource,
} from "./source-patch.js";

const cfg = () => ({
  sources: {
    feishu: {
      enabled: true,
      app_id: "cli_x",
      chat_ids: ["oc_1"],
      sources: { dm: true, messages: false },
    },
    "claude-code": { enabled: true },
  },
}) as never;

describe("source-patch", () => {
  it("toggleTopSource flips enabled, preserves siblings + other fields", () => {
    const p = toggleTopSource(cfg(), "codex", true);
    expect((p.sources as Record<string, { enabled?: boolean }>)?.codex?.enabled).toBe(true);
    expect((p.sources as Record<string, { enabled?: boolean }>)?.["claude-code"]?.enabled).toBe(true);
    expect((p.sources as Record<string, { app_id?: string }>)?.feishu?.app_id).toBe("cli_x");
  });

  it("toggleFeishuSubSource flips one sub-source, preserves others + feishu fields", () => {
    const p = toggleFeishuSubSource(cfg(), "messages", true);
    const feishu = (p.sources as Record<string, { sources?: Record<string, boolean>; chat_ids?: string[] }>)
      ?.feishu;
    expect(feishu?.sources?.messages).toBe(true);
    expect(feishu?.sources?.dm).toBe(true);
    expect(feishu?.chat_ids).toEqual(["oc_1"]);
  });

  it("setChatIds replaces chat_ids, preserves feishu fields + other sources", () => {
    const p = setChatIds(cfg(), ["oc_2", "oc_3"]);
    const sources = p.sources as Record<string, { chat_ids?: string[]; enabled?: boolean }>;
    expect(sources?.feishu?.chat_ids).toEqual(["oc_2", "oc_3"]);
    expect(sources?.feishu?.enabled).toBe(true);
    expect(sources?.["claude-code"]?.enabled).toBe(true);
  });
});
