import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { TimelineStore } from "../../src/store/timeline.js";

describe("TimelineStore", () => {
  let db: Database;
  let pages: PageStore;
  let timeline: TimelineStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    timeline = new TimelineStore(db.pg);
  });
  afterEach(async () => {
    await db.close();
  });

  it("addEntry and getTimeline", async () => {
    await pages.putPage("test/tl", "---\ntitle: T\ntype: test\n---\nBody.");
    await timeline.addEntry("test/tl", {
      date: "2026-05-25",
      summary: "Project started",
      detail: "Initial setup done",
      source: "chat",
    });
    await timeline.addEntry("test/tl", { date: "2026-05-26", summary: "First feature shipped" });
    const entries = await timeline.getTimeline("test/tl");
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe("2026-05-26");
    expect(entries[1].date).toBe("2026-05-25");
    expect(entries[1].detail).toBe("Initial setup done");
  });

  it("addEntry deduplicates on (page_id, date, summary)", async () => {
    await pages.putPage("test/dedup", "---\ntitle: D\ntype: test\n---\nBody.");
    await timeline.addEntry("test/dedup", {
      date: "2026-05-25",
      summary: "Same event",
      detail: "V1",
    });
    await timeline.addEntry("test/dedup", {
      date: "2026-05-25",
      summary: "Same event",
      detail: "V2 updated",
    });
    const entries = await timeline.getTimeline("test/dedup");
    expect(entries).toHaveLength(1);
    expect(entries[0].detail).toBe("V2 updated");
  });

  it("getTimeline returns empty for page with no entries", async () => {
    await pages.putPage("test/empty", "---\ntitle: E\ntype: test\n---\nBody.");
    const entries = await timeline.getTimeline("test/empty");
    expect(entries).toEqual([]);
  });

  it("entries cascade on page delete", async () => {
    await pages.putPage("test/del", "---\ntitle: D\ntype: test\n---\nBody.");
    await timeline.addEntry("test/del", { date: "2026-05-25", summary: "Event" });
    await pages.deletePage("test/del");
    const count = await db.pg.query("SELECT COUNT(*) AS c FROM timeline_entries");
    expect(Number(count.rows[0].c)).toBe(0);
  });

  it("getAllTimelineGrouped returns Map<slug, entries[]> for batch export", async () => {
    await pages.putPage("a", "---\ntitle: A\ntype: t\n---\n");
    await pages.putPage("b", "---\ntitle: B\ntype: t\n---\n");
    await timeline.addEntry("a", { date: "2026-05-20", summary: "Event 1" });
    await timeline.addEntry("a", { date: "2026-05-21", summary: "Event 2" });
    await timeline.addEntry("b", { date: "2026-05-22", summary: "Event B" });

    const grouped = await timeline.getAllTimelineGrouped();

    expect(grouped.get("a")).toHaveLength(2);
    expect(grouped.get("b")).toHaveLength(1);
    expect(grouped.get("b")?.[0].summary).toBe("Event B");
    expect(grouped.has("nonexistent")).toBe(false);
  });

  it("getAllTimelineGrouped returns empty Map when no entries", async () => {
    const grouped = await timeline.getAllTimelineGrouped();
    expect(grouped.size).toBe(0);
  });
});
