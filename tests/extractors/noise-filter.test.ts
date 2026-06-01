import { describe, expect, test } from "vitest";
import type { ConversationBlock, SignalScore } from "../../src/core/types.js";
import { filterNoiseL1, mapScoreDecision } from "../../src/extractors/noise-filter.js";

function makeBlock(
  channel: string,
  content: string,
  overrides?: Partial<ConversationBlock>,
): ConversationBlock {
  return {
    block_id: "test-1",
    platform: "feishu",
    channel,
    thread_id: undefined,
    messages: [
      {
        platform: "feishu",
        channel,
        contact: "alice",
        timestamp: "2026-05-29T10:00:00Z",
        content,
        direction: "received",
      },
    ],
    start_time: "2026-05-29T10:00:00Z",
    end_time: "2026-05-29T10:00:00Z",
    participants: ["alice"],
    token_count: 50,
    ...overrides,
  };
}

describe("filterNoiseL1 — chat/dm channel", () => {
  test("system notification → skip", () => {
    expect(filterNoiseL1(makeBlock("group/oc_abc", "张三 加入群聊"))).toBe("skip");
  });

  test("red packet → skip", () => {
    expect(filterNoiseL1(makeBlock("group/oc_abc", "[红包] 恭喜发财"))).toBe("skip");
  });

  test("emoji-only → skip", () => {
    expect(filterNoiseL1(makeBlock("group/oc_abc", "😂🎉👍"))).toBe("skip");
  });

  test("decision keyword → escalate", () => {
    expect(filterNoiseL1(makeBlock("group/oc_abc", "我们决定采用方案B"))).toBe("escalate");
  });

  test("task keyword → escalate", () => {
    expect(filterNoiseL1(makeBlock("group/oc_abc", "这个任务分配给小明，deadline周五"))).toBe(
      "escalate",
    );
  });

  test("normal chat → null (no decision)", () => {
    expect(filterNoiseL1(makeBlock("group/oc_abc", "今天天气不错，你吃了吗"))).toBeNull();
  });
});

describe("filterNoiseL1 — email channel", () => {
  test("auto-reply → skip", () => {
    expect(
      filterNoiseL1(
        makeBlock("mail/INBOX", "This is an auto-reply. I am out of office until Monday."),
      ),
    ).toBe("skip");
  });

  test("out of office → skip", () => {
    expect(filterNoiseL1(makeBlock("mail/INBOX", "Out of Office: I will return on June 1st"))).toBe(
      "skip",
    );
  });

  test("meeting cancelled → skip", () => {
    expect(filterNoiseL1(makeBlock("mail/INBOX", "会议取消：周五的项目评审已取消"))).toBe("skip");
  });

  test("normal email → null (no decision)", () => {
    expect(
      filterNoiseL1(makeBlock("mail/INBOX", "Hi team, here's the weekly status report.")),
    ).toBeNull();
  });

  test("email with decision keyword → escalate", () => {
    expect(filterNoiseL1(makeBlock("mail/INBOX", "经讨论我们决定采用新方案"))).toBe("escalate");
  });
});

describe("filterNoiseL1 — document channel", () => {
  test("document → null (always pass through)", () => {
    expect(filterNoiseL1(makeBlock("docs/folder1", "API设计文档 v2.0"))).toBeNull();
  });
});

describe("filterNoiseL1 — structured channel", () => {
  test("calendar event → null (always pass through)", () => {
    expect(filterNoiseL1(makeBlock("calendar/primary", "Team standup meeting"))).toBeNull();
  });

  test("tasks → null (always pass through)", () => {
    expect(filterNoiseL1(makeBlock("tasks", "Complete the migration script"))).toBeNull();
  });
});

describe("mapScoreDecision", () => {
  test("admit → pass", () => {
    expect(mapScoreDecision({ decision: "admit" } as SignalScore)).toBe("pass");
  });

  test("drop → skip", () => {
    expect(mapScoreDecision({ decision: "drop" } as SignalScore)).toBe("skip");
  });

  test("evaluate → pass", () => {
    expect(mapScoreDecision({ decision: "evaluate" } as SignalScore)).toBe("pass");
  });
});
