import { describe, expect, it, vi } from "vitest";
import type { FeishuHttpClient } from "../../../../src/collectors/feishu/http-client";
import { TaskSource } from "../../../../src/collectors/feishu/sources/tasks";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import fixtureData from "../fixtures/tasks.json";

function createMockClient(items: unknown[]): FeishuHttpClient {
  return {
    request: vi.fn(),
    paginate: vi.fn().mockImplementation(async function* () {
      yield { items, has_more: false };
    }),
  } as unknown as FeishuHttpClient;
}

describe("TaskSource", () => {
  it("yields RawMessage for each task", async () => {
    const client = createMockClient(fixtureData.data.items);
    const source = new TaskSource(client);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);

    const msg1 = messages[0] as {
      platform: string; channel: string; content: string;
      metadata?: { task_id?: string; status?: string; priority?: string };
    };
    expect(msg1.platform).toBe("feishu");
    expect(msg1.channel).toBe("tasks");
    expect(msg1.content).toContain("完成 API 集成测试");
    expect(msg1.content).toContain("需要覆盖所有边界条件");
    expect(msg1.metadata?.task_id).toBe("task_001");
    expect(msg1.metadata?.status).toBe("open");
    expect(msg1.metadata?.priority).toBe("high");
  });

  it("maps completed task status correctly", async () => {
    const client = createMockClient(fixtureData.data.items);
    const source = new TaskSource(client);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    const msg2 = messages[1] as { metadata?: { status?: string; completed_at?: string } };
    expect(msg2.metadata?.status).toBe("completed");
    expect(msg2.metadata?.completed_at).toBeDefined();
  });

  it("maps assignees and followers from members", async () => {
    const client = createMockClient(fixtureData.data.items);
    const source = new TaskSource(client);
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    const msg1 = messages[0] as {
      metadata?: {
        assignees?: Array<{ id: string }>;
        followers?: Array<{ id: string }>;
      };
    };
    expect(msg1.metadata?.assignees).toEqual([{ id: "ou_user_002" }]);
    expect(msg1.metadata?.followers).toEqual([{ id: "ou_user_003" }]);
  });

  it("commits cursor with max updated_at", async () => {
    const client = createMockClient(fixtureData.data.items);
    const source = new TaskSource(client);
    const staging = new CursorStaging();

    for await (const _ of source.fetch(null, staging)) { /* consume */ }

    const committable = staging.getCommittable();
    expect(committable).toHaveProperty("tasks");
    expect(committable.tasks).toHaveProperty("default");
    const cursor = committable.tasks.default as { last_update_time: number };
    expect(cursor.last_update_time).toBe(1716350000 * 1000);
  });

  it("passes updated_from when checkpoint exists", async () => {
    const paginateMock = vi.fn().mockImplementation(async function* () {
      yield { items: [], has_more: false };
    });
    const client = { request: vi.fn(), paginate: paginateMock } as unknown as FeishuHttpClient;
    const source = new TaskSource(client);
    const staging = new CursorStaging();

    const checkpoint = {
      default: { last_update_time: 1716200000000 },
    };

    for await (const _ of source.fetch(checkpoint, staging)) { /* consume */ }

    expect(paginateMock).toHaveBeenCalledWith(
      "/open-apis/task/v2/tasks",
      expect.objectContaining({ updated_from: "1716200000" }),
    );
  });
});
