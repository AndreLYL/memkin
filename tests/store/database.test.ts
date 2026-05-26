import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";

describe("Database", () => {
  let db: Database;

  afterEach(async () => {
    if (db) await db.close();
  });

  it("creates in-memory database with all tables", async () => {
    db = await Database.create();

    const tables = await db.pg.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const names = tables.rows.map((r) => r.tablename);
    expect(names).toContain("pages");
    expect(names).toContain("content_chunks");
    expect(names).toContain("links");
    expect(names).toContain("tags");
    expect(names).toContain("timeline_entries");
  });

  it("has pgvector extension loaded", async () => {
    db = await Database.create();
    const ext = await db.pg.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
    expect(ext.rows).toHaveLength(1);
  });

  it("has FTS triggers installed", async () => {
    db = await Database.create();

    await db.pg.query(`
      INSERT INTO pages (slug, type, title, compiled_truth)
      VALUES ('test-page', 'test', 'Hello World', 'some content here')
    `);
    const result = await db.pg.query(
      "SELECT search_vector IS NOT NULL AS has_sv FROM pages WHERE slug = 'test-page'",
    );
    expect(result.rows[0].has_sv).toBe(true);
  });
});
