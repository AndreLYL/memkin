import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PAGES_DIR, type SeedSummary, seedDemo } from "../../src/demo/seed.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TimelineStore } from "../../src/store/timeline.js";

const REPO_ROOT = resolve(__dirname, "../..");
const PAGES_DIR = resolve(REPO_ROOT, DEMO_PAGES_DIR);

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

describe("demo seed", () => {
  // Seeding 40+ pages into PGLite is expensive — share one seeded database
  // across the read-only assertions below (the idempotency test re-seeds the
  // same db, which is exactly the behavior it verifies).
  let db: Database;
  let first: SeedSummary;

  beforeAll(async () => {
    db = await Database.create(); // in-memory PGLite — never touches a real library
    first = await seedDemo(db, { pagesDir: PAGES_DIR });
  });

  afterAll(async () => {
    await db.close();
  });

  it("seeds >=30 pages covering every signal type, with timeline and graph links", async () => {
    const pages = new PageStore(db.executor);
    const all = await pages.listPages();
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(first.pages).toBe(all.length);

    // Every signal type from the demo dataset is represented at least once.
    const types = new Set(all.map((p) => p.type));
    for (const t of [
      "decision",
      "task",
      "knowledge",
      "preference",
      "reference",
      "person",
      "project",
      "organization",
      "tool",
      "concept",
    ]) {
      expect(types, `missing signal type: ${t}`).toContain(t);
    }

    // Wikilinks were wired into typed graph edges.
    const links = await db.executor.query<{ cnt: string | number }>(
      "SELECT COUNT(*) AS cnt FROM links",
    );
    expect(Number(links.rows[0].cnt)).toBeGreaterThan(0);
    expect(first.links).toBe(Number(links.rows[0].cnt));

    // Timeline entries exist and land inside the "last week" window relative to now.
    const feed = await new TimelineStore(db.executor).feed({ limit: 100 });
    expect(feed.length).toBeGreaterThanOrEqual(10);
    expect(first.timelineEntries).toBe(feed.length);
    const now = Date.now();
    for (const entry of feed) {
      const t = new Date(entry.time).getTime();
      expect(t).toBeLessThanOrEqual(now + 60 * 60 * 1000);
      expect(t).toBeGreaterThanOrEqual(now - 8 * 86_400_000);
    }
  });

  it("contains the three Alice anchor signals and search 'Alice' hits >=3", async () => {
    const pages = new PageStore(db.executor);

    const decision = await pages.getPage("decisions/phoenix-launch-friday");
    expect(decision?.type).toBe("decision");
    expect(decision?.title).toBe(
      "Ship the Phoenix launch on Friday; cut the onboarding tour from v1",
    );

    const task = await pages.getPage("tasks/send-alice-pricing-copy");
    expect(task?.type).toBe("task");
    expect(task?.title).toBe("Send Alice the final pricing page copy by Wednesday");

    const knowledge = await pages.getPage("knowledge/alice-prefers-async-loom");
    expect(knowledge?.type).toBe("knowledge");
    expect(knowledge?.title).toBe("Alice prefers async Loom reviews over live design crits");

    // FTS (no embeddings needed): the demo GIF question must be able to hit these.
    const search = new SearchEngine(db.executor);
    const hits = await search.search("Alice");
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("resolves forward wikilinks (pages written later in the seed order)", async () => {
    // entities/alice-chen references references/design-system-doc which is
    // seeded after entity pages — only a second wiring pass can create this edge.
    const result = await db.executor.query<{ cnt: string | number }>(
      `SELECT COUNT(*) AS cnt FROM links l
       JOIN pages f ON f.id = l.from_page_id
       JOIN pages t ON t.id = l.to_page_id
       WHERE f.slug = 'entities/alice-chen' AND t.slug = 'references/design-system-doc'`,
    );
    expect(Number(result.rows[0].cnt)).toBe(1);
  });

  it("is idempotent: re-running does not duplicate pages, links, or timeline entries", async () => {
    const second = await seedDemo(db, { pagesDir: PAGES_DIR });

    expect(second.pages).toBe(first.pages);
    expect(second.links).toBe(first.links);
    expect(second.timelineEntries).toBe(first.timelineEntries);

    const pageCount = await db.executor.query<{ cnt: string | number }>(
      "SELECT COUNT(*) AS cnt FROM pages",
    );
    expect(Number(pageCount.rows[0].cnt)).toBe(first.pages);
    const timelineCount = await db.executor.query<{ cnt: string | number }>(
      "SELECT COUNT(*) AS cnt FROM timeline_entries",
    );
    expect(Number(timelineCount.rows[0].cnt)).toBe(first.timelineEntries);
  });

  it("demo page files contain no hardcoded calendar dates (time-bomb guard)", () => {
    for (const file of walkMarkdown(PAGES_DIR)) {
      const content = readFileSync(file, "utf-8");
      expect(content, `hardcoded date in ${file}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});
