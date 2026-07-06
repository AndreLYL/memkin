import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Database } from "./database.js";
import { PageStore } from "./pages.js";
import { detectIdSequenceDesync, resyncIdSequences } from "./sequence-sync.js";

/**
 * Simulates an id-preserving import (dump/restore that copies rows with explicit
 * ids but never runs setval) — the real-world cause of pages_id_seq falling
 * behind MAX(id). INSERT with an explicit id does NOT advance the sequence.
 */
async function importPageWithExplicitId(db: Database, id: number, slug: string): Promise<void> {
  await db.executor.query(
    `INSERT INTO pages (id, slug, type, title, compiled_truth, frontmatter)
     VALUES ($1, $2, 'knowledge', 't', '', '{}')`,
    [id, slug],
  );
}

describe("sequence-sync — SERIAL id 序列与数据失步的检测与修复", () => {
  it("重现:id 保留式导入后,putPage 新 slug 撞 pages_pkey;resync 后恢复", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      // Fresh DB: pages_id_seq next value is 1. Import rows with explicit ids 1,2.
      await importPageWithExplicitId(db, 1, "imported/one");
      await importPageWithExplicitId(db, 2, "imported/two");

      const pages = new PageStore(db.executor);

      // The bug: nextval returns 1 which is already taken → pages_pkey violation,
      // even though the slug is brand new (ON CONFLICT (slug) cannot arbitrate it).
      await expect(pages.putPage("decisions/brand-new", "hello")).rejects.toThrow(
        /pages_pkey|duplicate key/,
      );

      const repaired = await resyncIdSequences(db.executor);
      expect(repaired.map((r) => r.table)).toContain("pages");

      const page = await pages.putPage("decisions/brand-new", "hello");
      expect(page.slug).toBe("decisions/brand-new");
      expect(page.id).toBeGreaterThan(2);
    } finally {
      await db.close();
    }
  });

  it("detect 只报告失步,不修改序列", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await importPageWithExplicitId(db, 5, "imported/five");

      const first = await detectIdSequenceDesync(db.executor);
      const pagesDesync = first.find((d) => d.table === "pages");
      expect(pagesDesync).toBeDefined();
      expect(pagesDesync?.maxId).toBe(5);

      // Detection is read-only: a second detect sees the same desync.
      const second = await detectIdSequenceDesync(db.executor);
      expect(second.find((d) => d.table === "pages")).toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("健康库 no-op:正常 putPage 后 detect 返回空,resync 不动序列", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      await pages.putPage("a", "one");
      await pages.putPage("b", "two");

      expect(await detectIdSequenceDesync(db.executor)).toEqual([]);
      expect(await resyncIdSequences(db.executor)).toEqual([]);

      // Sequence untouched: next insert still gets the next contiguous id.
      const c = await pages.putPage("c", "three");
      expect(c.id).toBe(3);
    } finally {
      await db.close();
    }
  });

  it("覆盖非 pages 的 serial 表(timeline_entries)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await importPageWithExplicitId(db, 1, "imported/one");
      await db.executor.query(
        `INSERT INTO timeline_entries (id, page_id, date, summary) VALUES (7, 1, '2026-07-02', 's')`,
      );

      const desync = await detectIdSequenceDesync(db.executor);
      expect(desync.map((d) => d.table)).toContain("timeline_entries");

      await resyncIdSequences(db.executor);
      // New timeline insert (sequence-generated id) must not collide.
      await db.executor.query(
        `INSERT INTO timeline_entries (page_id, date, summary) VALUES (1, '2026-07-03', 's2')`,
      );
    } finally {
      await db.close();
    }
  });

  it("缺表时跳过而不是抛错(doctor 对未初始化库友好)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.exec("DROP TABLE tags CASCADE");
      const desync = await detectIdSequenceDesync(db.executor);
      expect(desync.map((d) => d.table)).not.toContain("tags");
    } finally {
      await db.close();
    }
  });

  it("Database.create 重新打开磁盘库时自动修复失步", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memoark-seq-"));
    try {
      const db1 = await Database.create(dir, { embeddingDimensions: 768 });
      await importPageWithExplicitId(db1, 1, "imported/one");
      await importPageWithExplicitId(db1, 2, "imported/two");
      await db1.close();

      // Re-open: bootstrap must resync sequences, so a new-slug write just works.
      const db2 = await Database.create(dir, { embeddingDimensions: 768 });
      try {
        const pages = new PageStore(db2.executor);
        const page = await pages.putPage("decisions/after-reopen", "hello");
        expect(page.id).toBeGreaterThan(2);
      } finally {
        await db2.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
