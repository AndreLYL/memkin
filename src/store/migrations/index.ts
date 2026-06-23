import type { PGlite } from "@electric-sql/pglite";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Migrations are inlined as string constants (not read from .sql files at runtime) so
// they survive bundling: the tsc-built dist/, the `bun build --compile` single-file binary,
// and `bun src/cli.ts` all behave identically with no filesystem asset to ship. Applied
// migrations are immutable by definition, so there is no source-of-truth drift risk.
//
// Add new migrations here, in ascending version order. Never edit an already-released one.

// Migration 001: lifecycle metadata + preference type promotion.
// Adds halflife_days to pages (drives hot/warm/cold rotation), promotes the legacy
// discovery-preference subtype to a first-class `preference` type, then backfills
// halflife_days for existing signal pages by type.
const M001_LIFECYCLE_COLUMNS = `
ALTER TABLE pages ADD COLUMN IF NOT EXISTS halflife_days INTEGER;

UPDATE pages SET type = 'preference' WHERE type = 'discovery-preference';

UPDATE pages SET halflife_days = 90
  WHERE type IN ('decision', 'task', 'preference') OR type LIKE 'discovery-%';
UPDATE pages SET halflife_days = 365
  WHERE type = 'knowledge';
`;

// Migration 002: backfill provenance/source_hash columns (signal fidelity) for databases
// that ran migration 001 before schema.sql included them.
const M002_PROVENANCE_COLUMNS = `
ALTER TABLE links ADD COLUMN IF NOT EXISTS provenance JSONB;
ALTER TABLE links ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS provenance JSONB;
`;

// Migration 003: lifecycle tier columns + indexes for pages and timeline_entries, and a
// backfill of expires_at for existing hot pages that have a halflife.
const M003_LIFECYCLE_TIER = `
ALTER TABLE pages ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'hot';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS consolidated_into INTEGER REFERENCES pages(id);

CREATE INDEX IF NOT EXISTS idx_pages_tier ON pages (tier);
CREATE INDEX IF NOT EXISTS idx_pages_expires_at ON pages (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'hot';
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE pages
SET expires_at = created_at + (halflife_days * INTERVAL '1 day')
WHERE tier = 'hot'
  AND halflife_days IS NOT NULL
  AND expires_at IS NULL;
`;

// Migration 004: relax identity_cache.display_name to nullable.
// Semantics: display_name IS NULL AND resolved_at IS NOT NULL = permanent
// resolution failure (e.g. Lark 4013/404). Used by the chat-name resolution
// flow to distinguish "tried and failed" from "never tried".
const M004_IDENTITY_CACHE_NULLABLE = `
ALTER TABLE identity_cache ALTER COLUMN display_name DROP NOT NULL;
`;

// Migration 005: person_behavior table (Spec 8 §4.1) — the behavior layer of the
// person communication profile. Behavior metrics (response latency, message length,
// active hours, initiation, @-frequency) cannot be recomputed after extraction
// (raw messages are dropped), so they are accumulated incrementally as mergeable
// counters keyed by the OTHER person's canonical slug. hour_histogram defaults to a
// length-24 zero array so upsert can add element-wise without a null check.
const M005_PERSON_BEHAVIOR = `
CREATE TABLE IF NOT EXISTS person_behavior (
  person_slug        TEXT PRIMARY KEY,
  msg_count          INTEGER NOT NULL DEFAULT 0,
  sum_msg_chars      INTEGER NOT NULL DEFAULT 0,
  initiated_count    INTEGER NOT NULL DEFAULT 0,
  reply_count        INTEGER NOT NULL DEFAULT 0,
  resp_latency_n     INTEGER NOT NULL DEFAULT 0,
  resp_latency_sum_s BIGINT  NOT NULL DEFAULT 0,
  hour_histogram     JSONB   NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]',
  at_count           INTEGER NOT NULL DEFAULT 0,
  window_start       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "lifecycle_columns", sql: M001_LIFECYCLE_COLUMNS },
  { version: 2, name: "provenance_columns", sql: M002_PROVENANCE_COLUMNS },
  { version: 3, name: "lifecycle_tier", sql: M003_LIFECYCLE_TIER },
  { version: 4, name: "identity_cache_nullable", sql: M004_IDENTITY_CACHE_NULLABLE },
  { version: 5, name: "person_behavior", sql: M005_PERSON_BEHAVIOR },
];

export async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await pg.query<{ version: number }>("SELECT version FROM schema_migrations");
  const appliedVersions = new Set(applied.rows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    await pg.exec(migration.sql);
    await pg.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
  }
}
