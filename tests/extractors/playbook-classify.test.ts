import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationBlock } from "../../src/core/types.js";
import { classifyPlaybook, extractPlaybookDraft } from "../../src/extractors/playbook-extractor.js";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";

function block(text: string): ConversationBlock {
  return {
    block_id: "b1",
    platform: "feishu",
    channel: "docs/runbook",
    thread_id: undefined,
    start_time: "2026-06-22T10:00:00.000Z",
    end_time: "2026-06-22T10:05:00.000Z",
    participants: ["alice"],
    messages: [
      {
        timestamp: "2026-06-22T10:00:00.000Z",
        contact: "alice",
        direction: "received",
        content: text,
      },
    ],
  } as unknown as ConversationBlock;
}

describe("playbook-aware pre-classify", () => {
  it("classifies a troubleshooting flow as playbook (rule keywords)", () => {
    const text =
      "智驾无法激活排查步骤：先去 /xxx/log 执行 grep deact，看日志结果，如果命中 sensor timeout 则传感器超时。";
    expect(classifyPlaybook(text)).toBe(true);
  });

  it("does not classify ordinary chatter as playbook", () => {
    const text = "明天中午一起吃饭吗？我订了餐厅。";
    expect(classifyPlaybook(text)).toBe(false);
  });
});

describe("playbook draft extraction", () => {
  let db: Database;
  let pages: PageStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("writes a type=playbook draft page (markdown body, inferred confidence, draft tag)", async () => {
    const markdown = [
      "## 适用场景",
      "系统未进入 active 状态。",
      "",
      "## 步骤",
      '1. 去 `/xxx/log`，执行 `cat xxx | grep "deact"`',
      "2. 看 grep 结果：",
      "   - 命中 `sensor timeout` → 传感器超时",
      "",
      "## 关联",
      "[[part_of:problem-class/activation-failure]]",
    ].join("\n");

    const provider = createMockProvider(new Map([["", markdown]]));
    const b = block(
      "智驾无法激活排查步骤：去 /xxx/log 执行 grep deact，看日志，如果命中 sensor timeout 则超时。",
    );

    const slug = await extractPlaybookDraft(b, provider, pages);
    expect(slug).toBeTruthy();
    expect(slug?.startsWith("playbook/")).toBe(true);

    const page = await pages.getPage(slug as string);
    expect(page?.type).toBe("playbook");
    expect(page?.frontmatter.confidence).toBe("inferred");
    expect(page?.frontmatter.tags).toContain("draft");
    expect(page?.compiled_truth).toContain("## 步骤");
  });
});
