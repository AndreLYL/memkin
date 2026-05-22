import { describe, it, expect, vi } from "vitest";
import { FeishuCollector, createFeishuCollector } from "../../../src/collectors/feishu/collector";
import type { FeishuCollectorConfig } from "../../../src/collectors/feishu/types";
import type { RawMessage } from "../../../src/core/types";

const baseConfig: FeishuCollectorConfig = {
  app_id: "cli_test_app",
  app_secret: "test_secret",
  sources: {
    messages: {
      enabled: true,
      chat_ids: ["oc_chat_001", "oc_chat_002"],
      lookback_days: 30,
    },
    calendar: {
      enabled: true,
      calendar_ids: ["cal_primary"],
    },
  },
};

describe("FeishuCollector", () => {
  it("has correct id and metadata", () => {
    const collector = createFeishuCollector(baseConfig);
    expect(collector.id).toBe("feishu");
    expect(collector.name).toBe("Feishu");
    expect(collector.description).toContain("Feishu");
  });

  it("healthCheck passes with valid config", async () => {
    const collector = createFeishuCollector(baseConfig);
    (collector as any).auth = { getToken: vi.fn().mockResolvedValue("t-ok"), forceRefresh: vi.fn() };
    const health = await collector.healthCheck();
    expect(health.ok).toBe(true);
  });

  it("fetch yields messages from all enabled sources", async () => {
    const collector = createFeishuCollector(baseConfig);

    const mockMessages: RawMessage[] = [
      {
        platform: "feishu",
        channel: "group/oc_chat_001",
        contact: "ou_user_001",
        timestamp: new Date().toISOString(),
        content: "hello from messages",
        direction: "received",
      },
      {
        platform: "feishu",
        channel: "calendar/cal_primary",
        contact: "ou_org_001",
        timestamp: new Date().toISOString(),
        content: "Sprint Review",
        direction: "received",
      },
    ];

    (collector as any).sources = [
      {
        name: "messages",
        fetch: async function* () { yield mockMessages[0]; },
        healthCheck: async () => true,
      },
      {
        name: "calendar",
        fetch: async function* () { yield mockMessages[1]; },
        healthCheck: async () => true,
      },
    ];

    const results: RawMessage[] = [];
    for await (const msg of collector.fetch({})) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("hello from messages");
    expect(results[1].content).toBe("Sprint Review");
  });

  it("isolates source failures — other sources continue", async () => {
    const collector = createFeishuCollector(baseConfig);

    const goodMsg: RawMessage = {
      platform: "feishu",
      channel: "calendar/cal_primary",
      contact: "ou_org_001",
      timestamp: new Date().toISOString(),
      content: "Sprint Review",
      direction: "received",
    };

    (collector as any).sources = [
      {
        name: "messages",
        fetch: async function* () { throw new Error("API down"); },
        healthCheck: async () => true,
      },
      {
        name: "calendar",
        fetch: async function* () { yield goodMsg; },
        healthCheck: async () => true,
      },
    ];

    const results: RawMessage[] = [];
    for await (const msg of collector.fetch({})) {
      results.push(msg);
    }

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Sprint Review");
  });

  it("getCommittableCursors returns staged cursors from sources", async () => {
    const collector = createFeishuCollector(baseConfig);

    const msg: RawMessage = {
      platform: "feishu", channel: "group/oc_chat_001", contact: "u1",
      timestamp: new Date().toISOString(), content: "test", direction: "received",
    };

    (collector as any).sources = [
      {
        name: "messages",
        fetch: async function* (_cp: any, staging: any) {
          staging.stage("messages", "oc_chat_001", { last_sync_at: 1716300000000 });
          staging.commit("messages", "oc_chat_001");
          yield msg;
        },
        healthCheck: async () => true,
      },
    ];

    for await (const _ of collector.fetch({})) { /* consume */ }

    const cursors = collector.getCommittableCursors();
    expect((cursors as any).messages.oc_chat_001.last_sync_at).toBe(1716300000000);
  });

  it("discardSource removes staged cursors for failed source", () => {
    const collector = createFeishuCollector(baseConfig);

    (collector as any).cursorStaging.stage("messages", "oc_chat_001", { last_sync_at: 123 });
    (collector as any).cursorStaging.commit("messages", "oc_chat_001");
    collector.discardSource("messages");

    const cursors = collector.getCommittableCursors();
    expect((cursors as any).messages).toBeUndefined();
  });

  it("skips disabled sources", () => {
    const config: FeishuCollectorConfig = {
      ...baseConfig,
      sources: {
        messages: { enabled: false, chat_ids: [], lookback_days: 30 },
        calendar: { enabled: true, calendar_ids: ["cal_primary"] },
      },
    };
    const collector = createFeishuCollector(config);
    const sourceNames = (collector as any).sources.map((s: any) => s.name);
    expect(sourceNames).not.toContain("messages");
    expect(sourceNames).toContain("calendar");
  });
});
