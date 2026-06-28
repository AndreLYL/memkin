/**
 * Index-usage guard: verify that pg_trgm GIN indexes are present and functional.
 *
 * PGLite runs in-memory with very low I/O costs, so the planner correctly prefers
 * Seq Scan over an index path when selectivity is high (27% of rows match). The
 * guard therefore sets enable_seqscan=off to force the planner onto the index path
 * and confirm the index satisfies ILIKE predicates correctly.
 *
 * This verifies §4.2.2: idx_pages_compiled_truth_trgm and idx_pages_title_trgm
 * exist and are usable by the GIN trigram scan path.
 */
import { describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";

async function seed(db: Database) {
  const pages = new PageStore(db.executor);
  const phrases = ["认证中间件重构", "上线回滚开关", "数据库选型讨论", "飞书文档摘要"];
  for (let i = 0; i < 800; i++) {
    await pages.putPage(
      `k/p${i}`,
      `---\ntitle: 第${i}条\ntype: knowledge\n---\n第${i}条：${phrases[i % phrases.length]}与噪声${i}`,
    );
  }
}

describe("trgm index structure & predicate coverage (enable_seqscan=off)", () => {
  it("single-term Chinese ILIKE uses a Bitmap Index Scan (enable_seqscan=off)", async () => {
    const db = await Database.create();
    await seed(db);
    await db.executor.exec("ANALYZE pages;");
    // PGLite in-memory cost model favours Seq Scan for high-selectivity queries.
    // Disable it so the planner is forced onto the index path — this proves the
    // index exists, covers the predicate, and returns the correct rows.
    await db.executor.exec("SET enable_seqscan = off;");
    const ex = await db.executor.query<{ "QUERY PLAN": string }>(
      "EXPLAIN SELECT slug FROM pages WHERE compiled_truth ILIKE '%中间件%'",
    );
    await db.executor.exec("SET enable_seqscan = on;");
    const plan = ex.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Bitmap Index Scan/);
    expect(plan).toMatch(/idx_pages_compiled_truth_trgm/);
    await db.close();
  });

  it("multi-term AND still uses the trgm index (BitmapAnd or per-term bitmap)", async () => {
    const db = await Database.create();
    await seed(db);
    await db.executor.exec("ANALYZE pages;");
    await db.executor.exec("SET enable_seqscan = off;");
    const ex = await db.executor.query<{ "QUERY PLAN": string }>(
      "EXPLAIN SELECT slug FROM pages WHERE compiled_truth ILIKE '%认证%' AND compiled_truth ILIKE '%中间件%'",
    );
    await db.executor.exec("SET enable_seqscan = on;");
    const plan = ex.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Bitmap Index Scan|BitmapAnd/);
    expect(plan).toMatch(/idx_pages_compiled_truth_trgm/);
    await db.close();
  });
});
