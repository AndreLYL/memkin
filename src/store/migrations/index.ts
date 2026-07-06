import type { SqlConn } from "../sql-executor.js";

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

// Migration 006: Chinese FTS fix. Replace the tsvector('simple') lexical machinery with
// pg_trgm. Chinese has no whitespace, so to_tsvector('simple') collapsed each run into one
// giant lexeme and to_tsquery matched only exact whole-run strings — Chinese FTS was broken.
// pg_trgm GIN + ILIKE substring gives correct CJK recall with no re-extraction. CREATE
// EXTENSION must precede any gin_trgm_ops index.
const M006_TRGM_FTS = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pages_title_trgm ON pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_compiled_truth_trgm ON pages USING gin (compiled_truth gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_text_trgm ON content_chunks USING gin (chunk_text gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_pages_search_vector ON pages;
DROP TRIGGER IF EXISTS chunk_search_vector_trigger ON content_chunks;
DROP FUNCTION IF EXISTS update_page_search_vector();
DROP FUNCTION IF EXISTS update_chunk_search_vector();
DROP INDEX IF EXISTS idx_pages_search_vector;
DROP INDEX IF EXISTS idx_chunks_search_vector;
ALTER TABLE pages DROP COLUMN IF EXISTS search_vector;
ALTER TABLE content_chunks DROP COLUMN IF EXISTS search_vector;
`;

// Migration 007: agent_sessions processing ledger (extraction-quality-redesign PR-0).
// One row per session REVISION, keyed by (source_instance, session_id, content_hash) so a
// changed transcript (new content_hash) lands as a fresh revision without clobbering history.
// This replaces the lossy per-agent cursor watermark (claude-code compared sessionId
// lexicographically, permanently dropping recovered sessions). The state machine models the
// distill→apply lifecycle; PR-0 only writes `discovered` and lays down the reserved columns
// (payload_id, staging_applied_at, prod_applied_at) that PR-2/PR-4 populate. Migration-only
// (like M005 person_behavior) — runMigrations runs on both fresh and upgraded databases.
const M007_AGENT_SESSIONS = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                 SERIAL PRIMARY KEY,
  source_instance    TEXT NOT NULL,
  session_id         TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  byte_size          BIGINT NOT NULL,
  line_count         INTEGER NOT NULL,
  state              TEXT NOT NULL DEFAULT 'discovered'
                       CHECK (state IN ('discovered','distilled','applying','done','retrying','dead_letter')),
  retry_count        INTEGER NOT NULL DEFAULT 0,
  payload_id         INTEGER,
  staging_applied_at TIMESTAMPTZ,
  prod_applied_at    TIMESTAMPTZ,
  discovered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_instance, session_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_lookup ON agent_sessions (source_instance, session_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions (state);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "lifecycle_columns", sql: M001_LIFECYCLE_COLUMNS },
  { version: 2, name: "provenance_columns", sql: M002_PROVENANCE_COLUMNS },
  { version: 3, name: "lifecycle_tier", sql: M003_LIFECYCLE_TIER },
  { version: 4, name: "identity_cache_nullable", sql: M004_IDENTITY_CACHE_NULLABLE },
  { version: 5, name: "person_behavior", sql: M005_PERSON_BEHAVIOR },
  { version: 6, name: "trgm_fts", sql: M006_TRGM_FTS },
  { version: 7, name: "agent_sessions", sql: M007_AGENT_SESSIONS },
];

export async function runMigrations(conn: SqlConn): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await conn.query<{ version: number }>("SELECT version FROM schema_migrations");
  const appliedVersions = new Set(applied.rows.map((r) => r.version));

  for (const m of MIGRATIONS) {
    if (appliedVersions.has(m.version)) continue;
    // Run the migration SQL and record the version atomically so a mid-migration
    // crash cannot leave the DB with applied schema but no version record.
    await conn.exec(
      `BEGIN; ${m.sql}; INSERT INTO schema_migrations (version) VALUES (${m.version}); COMMIT;`,
    );
  }
}
