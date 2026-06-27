import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database, loadSchemaSql } from "../../src/store/database.js";
import { runMigrations } from "../../src/store/migrations/index.js";
import { PgliteExecutor } from "../../src/store/pglite-executor.js";
import type { SqlConn } from "../../src/store/sql-executor.js";

/** Minimal SqlConn wrapper around a raw PGlite for tests that pre-date PgliteExecutor. */
function pgAsConn(pg: PGlite): SqlConn {
  return {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => pg.query<T>(sql, params),
    exec: (sql: string) => pg.exec(sql).then(() => undefined),
  };
}

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
    expect(rows.rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("adds halflife_days column to pages", async () => {
    const cols = await db.pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pages' AND column_name = 'halflife_days'`,
    );
    expect(cols.rows).toHaveLength(1);
  });

  it("adds provenance/source_hash columns to links and timeline_entries", async () => {
    const cols = await db.pg.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE (table_name = 'links' AND column_name IN ('provenance', 'source_hash'))
          OR (table_name = 'timeline_entries' AND column_name = 'provenance')`,
    );
    const found = cols.rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
    expect(found).toEqual(["links.provenance", "links.source_hash", "timeline_entries.provenance"]);
  });

  it("is idempotent: running migrations twice does not duplicate or error", async () => {
    await runMigrations(pgAsConn(db.pg));
    await runMigrations(pgAsConn(db.pg));
    const rows = await db.pg.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("migration 006 installs pg_trgm + trgm indexes and drops tsvector machinery", async () => {
    const pg = db.pg;
    // tsvector columns dropped
    const cols = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('pages','content_chunks') AND column_name = 'search_vector'`,
    );
    expect(cols.rows).toHaveLength(0);
    // triggers + functions dropped
    const trg = await pg.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_pages_search_vector','chunk_search_vector_trigger')`,
    );
    expect(trg.rows).toHaveLength(0);
    // trgm indexes present
    const idx = await pg.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN ('idx_pages_title_trgm','idx_pages_compiled_truth_trgm','idx_chunks_chunk_text_trgm')`,
    );
    expect(idx.rows.map((r) => r.indexname).sort()).toEqual([
      "idx_chunks_chunk_text_trgm",
      "idx_pages_compiled_truth_trgm",
      "idx_pages_title_trgm",
    ]);
  });

  it("remaps discovery-preference pages to preference type (first migration run)", async () => {
    // Fresh PGlite with only schema.sql applied — no migrations yet. Legacy rows
    // must exist *before* migration 1 first runs for its remap/backfill to apply;
    // under skip-gate semantics, rows inserted after the migration has already run
    // are the application write path's responsibility (it normalizes the type and
    // stamps halflife_days directly), not a re-run of this historical migration.
    const freshPg = new PGlite({ extensions: { vector, pg_trgm } });
    try {
      await freshPg.exec(loadSchemaSql());

      // Insert a legacy-shaped row directly (bypassing putPage, which would normalize the type)
      await freshPg.query(
        `INSERT INTO pages (slug, type, title, compiled_truth) VALUES ($1, $2, $3, $4)`,
        ["discoveries/old-pref", "discovery-preference", "Old preference", "legacy content"],
      );

      await runMigrations(pgAsConn(freshPg));

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
    const freshPg = new PGlite({ extensions: { vector, pg_trgm } });
    try {
      await freshPg.exec(loadSchemaSql());

      await freshPg.query(
        `INSERT INTO pages (slug, type, title, compiled_truth) VALUES
           ('decisions/d1', 'decision', 'D1', 'x'),
           ('tasks/t1', 'task', 'T1', 'x'),
           ('knowledge/k1/abc', 'knowledge', 'K1', 'x'),
           ('discoveries/dy1', 'discovery-pattern', 'DY1', 'x'),
           ('person/alice', 'person', 'Alice', 'x')`,
      );

      await runMigrations(pgAsConn(freshPg));

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

  it("adds tier/expires_at/consolidated_into columns to pages", async () => {
    const cols = await db.pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pages'
         AND column_name IN ('tier', 'expires_at', 'consolidated_into')
       ORDER BY column_name`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      "consolidated_into",
      "expires_at",
      "tier",
    ]);
  });

  it("adds tier/expires_at columns to timeline_entries", async () => {
    const cols = await db.pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'timeline_entries'
         AND column_name IN ('tier', 'expires_at')
       ORDER BY column_name`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(["expires_at", "tier"]);
  });

  it("backfills expires_at for existing hot pages with halflife_days", async () => {
    const freshPg = new PGlite({ extensions: { vector, pg_trgm } });
    try {
      await freshPg.exec(loadSchemaSql());
      // Insert legacy row that has halflife_days but no expires_at
      await freshPg.query(
        `INSERT INTO pages (slug, type, title, compiled_truth, halflife_days) VALUES ($1, $2, $3, $4, $5)`,
        ["decisions/old", "decision", "Old decision", "content", 90],
      );
      await runMigrations(pgAsConn(freshPg));
      const result = await freshPg.query<{ expires_at: string | null }>(
        "SELECT expires_at FROM pages WHERE slug = 'decisions/old'",
      );
      expect(result.rows[0].expires_at).not.toBeNull();
    } finally {
      await freshPg.close();
    }
  });
});

describe("runMigrations — SqlConn interface", () => {
  it("accepts a SqlConn and is idempotent (re-run = no-op, no duplicate versions)", async () => {
    const ex = await PgliteExecutor.create(undefined, {});
    // Load schema first (migrations depend on base tables: pages, content_chunks, etc.)
    const { loadSchemaSql: loadSchema } = await import("../../src/store/database.js");
    await ex.exec(loadSchema());
    await runMigrations(ex);
    await runMigrations(ex); // second run must not throw or duplicate
    const r = await ex.query<{ version: number; c: number }>(
      "SELECT version, count(*)::int AS c FROM schema_migrations GROUP BY version HAVING count(*) > 1",
    );
    expect(r.rows).toEqual([]); // no duplicate versions
    await ex.close();
  });
});
