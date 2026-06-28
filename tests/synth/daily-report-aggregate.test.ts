import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoreContext } from "../../src/server/api.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { assemble } from "../../src/synth/context.js";
import type { RawCandidate } from "../../src/synth/scope.js";
import { retrieve } from "../../src/synth/scope.js";

function signal(
  title: string,
  type: string,
  channel: string,
  sourceHash?: string,
  body = "some content",
): string {
  const src = [
    "source:",
    "  platform: feishu",
    `  channel: ${channel}`,
    "  timestamp: 2026-06-22T10:00:00Z",
    sourceHash ? `  raw_hash: ${sourceHash}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const fm = [`title: ${title}`, `type: ${type}`, src];
  if (sourceHash) fm.push(`source_hash: ${sourceHash}`);
  return `---\n${fm.join("\n")}\n---\n${body}`;
}

describe("daily report cross-channel aggregation", () => {
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
  });

  afterEach(async () => {
    await db.close();
  });

  it("retrieves cross-channel signals within the day window", async () => {
    const pages = stores.pages;
    await pages.putPage("mail/a", signal("收到邮件", "knowledge", "mail/inbox"));
    await pages.putPage("im/b", signal("群里讨论", "knowledge", "dm/feishu/g1"));
    await pages.putPage("cal/c", signal("评审会议", "knowledge", "calendar/x"));
    await pages.putPage("tasks/doc-DOC1-aaaa1111", signal("写迁移文档", "task", "doc:DOC1"));

    const out = await retrieve(
      { time: { from: "2026-06-22T00:00:00", to: "2026-06-22T23:59:59" }, limit: 200 },
      { poolByPage: true },
      stores,
    );
    const slugs = out.map((c) => c.slug);
    expect(slugs).toContain("mail/a");
    expect(slugs).toContain("im/b");
    expect(slugs).toContain("cal/c");
    expect(slugs).toContain("tasks/doc-DOC1-aaaa1111");
  });

  it("dedupes by source_hash (same source block) keeping one", async () => {
    const pages = stores.pages;
    // two different slugs, identical source_hash → one survives
    await pages.putPage("mail/dup1", signal("邮件A", "knowledge", "mail/inbox", "HASHZ"));
    await pages.putPage("im/dup2", signal("转发到群A", "knowledge", "dm/feishu/g1", "HASHZ"));
    await pages.putPage("mail/keep", signal("独立邮件", "knowledge", "mail/inbox", "OTHER"));

    const out = await retrieve(
      { time: { from: "2026-06-22T00:00:00", to: "2026-06-22T23:59:59" }, limit: 200 },
      { poolByPage: true },
      stores,
    );
    const hashedSlugs = out
      .map((c) => c.slug)
      .filter((s) => s.startsWith("mail/dup") || s === "im/dup2");
    expect(hashedSlugs.length).toBe(1);
    expect(out.some((c) => c.slug === "mail/keep")).toBe(true);
  });

  it("dedupes repeated slugs", async () => {
    const dup: RawCandidate[] = [
      { slug: "x/1", title: "A", type: "task", text: "aaa", date: "2026-06-22" },
      { slug: "x/1", title: "A", type: "task", text: "aaa", date: "2026-06-22" },
    ];
    const ctx = assemble({ time: { from: "x", to: "y" } }, dup);
    expect(ctx.candidates.length).toBe(1);
  });

  it("truncates candidates to a token budget", async () => {
    // Build many large candidates that blow past the budget.
    const big = "字".repeat(4000); // ~4000 chars each
    const many: RawCandidate[] = Array.from({ length: 50 }, (_, i) => ({
      slug: `big/${i}`,
      title: `T${i}`,
      type: "knowledge",
      text: big,
      date: "2026-06-22",
    }));
    const ctx = assemble({ time: { from: "x", to: "y" } }, many);
    expect(ctx.candidates.length).toBeLessThan(50);
    expect(ctx.candidates.length).toBeGreaterThan(0);
  });
});
