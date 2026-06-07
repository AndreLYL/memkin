import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { runMigrations } from "../../src/store/migrations/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../../src/store/schema.sql");

describe("migration runner", () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create();
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates schema_migrations table and records applied versions", async () => {
    const rows = await db.pg.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1]);
  });

  it("adds halflife_days column to pages", async () => {
    const cols = await db.pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pages' AND column_name = 'halflife_days'`,
    );
    expect(cols.rows).toHaveLength(1);
  });

  it("is idempotent: running migrations twice does not duplicate or error", async () => {
    await runMigrations(db.pg);
    await runMigrations(db.pg);
    const rows = await db.pg.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1]);
  });

  it("remaps discovery-preference pages to preference type (first migration run)", async () => {
    // Fresh PGlite with only schema.sql applied — no migrations yet. Legacy rows
    // must exist *before* migration 1 first runs for its remap/backfill to apply;
    // under skip-gate semantics, rows inserted after the migration has already run
    // are the application write path's responsibility (it normalizes the type and
    // stamps halflife_days directly), not a re-run of this historical migration.
    const freshPg = new PGlite({ extensions: { vector } });
    try {
      const schemaSql = readFileSync(schemaPath, "utf-8");
      await freshPg.exec(schemaSql);

      // Insert a legacy-shaped row directly (bypassing putPage, which would normalize the type)
      await freshPg.query(
        `INSERT INTO pages (slug, type, title, compiled_truth) VALUES ($1, $2, $3, $4)`,
        ["discoveries/old-pref", "discovery-preference", "Old preference", "legacy content"],
      );

      await runMigrations(freshPg);

      const result = await freshPg.query<{ type: string; halflife_days: number | null }>(
        "SELECT type, halflife_days FROM pages WHERE slug = $1",
        ["discoveries/old-pref"],
      );
      expect(result.rows[0].type).toBe("preference");
      expect(result.rows[0].halflife_days).toBe(90);
    } finally {
      await freshPg.close();
    }
  });

  it("backfills halflife_days by type for pre-existing signal pages (first migration run)", async () => {
    // Fresh PGlite with only schema.sql applied — no migrations yet. This models
    // the real-world scenario a backfill migration exists to handle: legacy rows
    // that existed *before* the migration first ran (not rows inserted afterward,
    // which the application write path stamps directly).
    const freshPg = new PGlite({ extensions: { vector } });
    try {
      const schemaSql = readFileSync(schemaPath, "utf-8");
      await freshPg.exec(schemaSql);

      await freshPg.query(
        `INSERT INTO pages (slug, type, title, compiled_truth) VALUES
           ('decisions/d1', 'decision', 'D1', 'x'),
           ('tasks/t1', 'task', 'T1', 'x'),
           ('knowledge/k1/abc', 'knowledge', 'K1', 'x'),
           ('discoveries/dy1', 'discovery-pattern', 'DY1', 'x'),
           ('person/alice', 'person', 'Alice', 'x')`,
      );

      await runMigrations(freshPg);

      const rows = await freshPg.query<{ slug: string; halflife_days: number | null }>(
        "SELECT slug, halflife_days FROM pages ORDER BY slug",
      );
      const bySlug = Object.fromEntries(rows.rows.map((r) => [r.slug, r.halflife_days]));
      expect(bySlug["decisions/d1"]).toBe(90);
      expect(bySlug["tasks/t1"]).toBe(90);
      expect(bySlug["knowledge/k1/abc"]).toBe(365);
      expect(bySlug["discoveries/dy1"]).toBe(90);
      expect(bySlug["person/alice"]).toBeNull(); // entity types: never expire
    } finally {
      await freshPg.close();
    }
  });
});
