import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import type { StoreContext } from "../../src/server/api.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { synthesize } from "../../src/synth/index.js";
import { getIntent } from "../../src/synth/intent.js";
import { dailyReportIntent } from "../../src/synth/intents/daily-report.js";

const SEVEN_SECTIONS = [
  "## 今日概览\n忙碌的一天。[1]",
  "## 今日完成\n完成了部署。[1]",
  "## 推进中\nMemoark 项目推进中。",
  "## 我的待办\n写迁移文档。",
  "## 待回复与被@\n无",
  "## 人脉动态\n与张三对齐。",
  "## 明日提醒\n明天评审会。",
].join("\n\n");

const FIVE_SECTIONS = [
  "## 今日概览\n概览。[1]",
  "## 今日完成\n完成了部署。[1]",
  "## 推进中\n推进中。",
  "## 人脉动态\n无",
  "## 明日提醒\n无",
].join("\n\n");

describe("daily_report intent", () => {
  let db: Database;
  let stores: StoreContext;

  beforeEach(async () => {
    db = await Database.create();
    const pages = new PageStore(db.executor);
    const chunks = new ChunkStore(db.executor);
    const graph = new GraphStore(db.executor);
    const timeline = new TimelineStore(db.executor);
    const search = new SearchEngine(db.executor);
    stores = { db, pages, chunks, graph, timeline, search } as unknown as StoreContext;

    const p = await pages.putPage(
      "decisions/deploy",
      "---\ntitle: 部署决定\ntype: decision\nsource:\n  platform: feishu\n  channel: dm/x\n  timestamp: 2026-06-22T09:00:00Z\n---\n今天决定上线 v2。",
    );
    await chunks.rechunk(p.id, p.compiled_truth);
  });

  afterEach(async () => {
    await db.close();
  });

  it("is registered and reachable via getIntent", () => {
    expect(getIntent("daily_report").id).toBe("daily_report");
    expect(dailyReportIntent.format).toBe("sections");
  });

  it("buildScope defaults to today and produces a time window", () => {
    const scope = dailyReportIntent.buildScope({ date: "2026-06-22" });
    expect(scope.time?.from).toBe("2026-06-22T00:00:00");
    expect(scope.time?.to).toBe("2026-06-22T23:59:59");

    const def = dailyReportIntent.buildScope({});
    expect(def.time?.from).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
  });

  it("returns 7 sections + an answer for a full report", async () => {
    const provider = createMockProvider(new Map([["", SEVEN_SECTIONS]]));
    const result = await synthesize(
      "daily_report",
      dailyReportIntent.buildScope({ date: "2026-06-22" }),
      { stores: stores as never, provider },
    );
    expect(result.answer).toBeTruthy();
    expect(result.sections).toHaveLength(7);
    const titles = result.sections?.map((s) => s.title);
    expect(titles).toEqual([
      "今日概览",
      "今日完成",
      "推进中",
      "我的待办",
      "待回复与被@",
      "人脉动态",
      "明日提醒",
    ]);
  });

  it("flags missing_field gap when expected sections are absent", async () => {
    const provider = createMockProvider(new Map([["", FIVE_SECTIONS]]));
    const result = await synthesize(
      "daily_report",
      dailyReportIntent.buildScope({ date: "2026-06-22" }),
      { stores: stores as never, provider },
    );
    expect(result.gaps.some((g) => g.type === "missing_field")).toBe(true);
  });

  it("caches the report to reports/daily/<date>", async () => {
    const provider = createMockProvider(new Map([["", SEVEN_SECTIONS]]));
    await synthesize("daily_report", dailyReportIntent.buildScope({ date: "2026-06-22" }), {
      stores: stores as never,
      provider,
    });
    const page = await stores.pages.getPage("reports/daily/2026-06-22");
    expect(page).not.toBeNull();
    expect(page?.type).toBe("knowledge");
    expect(page?.frontmatter.is_report).toBe(true);
  });
});
