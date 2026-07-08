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

// Migration 008: generalize person_handles → entity_handles (extraction-quality-redesign
// PR-3, spec §9). Entity normalization needs the same typed-handle registry for project
// and tool entities that persons already have — one table, namespaced by (entity_type,
// scope), NOT a parallel registry. Existing person rows are preserved with
// entity_type='person'. The primary key widens from (kind, value) to
// (entity_type, scope, kind, value) so "Codex the tool" and "Codex the project" can each
// hold a name handle in their own namespace.
//
// Two compat guards, both load-bearing:
//  - `person_handles` remains as a VIEW over entity_handles. Database.create re-applies
//    schema.sql (which has CREATE TABLE IF NOT EXISTS person_handles) on EVERY boot,
//    before migrations run; the view occupies the relation name so that statement skips
//    instead of resurrecting an empty parallel table.
//  - The idx_person_handles_slug index name is kept (table renames don't rename indexes);
//    schema.sql's CREATE INDEX IF NOT EXISTS matches by index name and skips. Renaming it
//    would make that statement try to index the view and fail.
const M008_ENTITY_HANDLES = `
ALTER TABLE person_handles RENAME TO entity_handles;
ALTER TABLE entity_handles ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'person'
  CHECK (entity_type IN ('person','project','organization','tool','concept'));
ALTER TABLE entity_handles ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';
ALTER TABLE entity_handles DROP CONSTRAINT person_handles_pkey;
ALTER TABLE entity_handles ADD CONSTRAINT entity_handles_pkey
  PRIMARY KEY (entity_type, scope, kind, value);

CREATE VIEW person_handles AS
  SELECT kind, value, canonical_slug, strength, created_at
  FROM entity_handles
  WHERE entity_type = 'person';
`;

// Migration 009: entity_merge_suggestions (extraction-quality-redesign PR-3, spec §9).
// Near-duplicate entity pages (exact same name, Levenshtein-close titles, pinyin-equivalent
// person names, cross-type name clashes) are NEVER merged automatically — detection only
// produces suggestion rows here, the consolidator aggregates them, and merges happen only
// after explicit user confirmation via the existing merge machinery. A dismissed suggestion
// must stay dismissed even though the sweep keeps re-detecting the same pair, hence status
// lives on the unique (entity_type, from_slug, into_slug, reason) row. Migration-only table
// (M005/M007 precedent) — runMigrations runs on both fresh and upgraded databases.
const M009_ENTITY_MERGE_SUGGESTIONS = `
CREATE TABLE IF NOT EXISTS entity_merge_suggestions (
  id          SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL
                CHECK (entity_type IN ('person','project','organization','tool','concept')),
  from_slug   TEXT NOT NULL,
  into_slug   TEXT NOT NULL,
  reason      TEXT NOT NULL
                CHECK (reason IN ('same_name','cross_type_name','levenshtein','pinyin')),
  detail      JSONB,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (entity_type, from_slug, into_slug, reason)
);

CREATE INDEX IF NOT EXISTS idx_entity_merge_suggestions_status
  ON entity_merge_suggestions (status);
`;

// Migration 010: distilled_payload outbox (extraction-quality-redesign PR-2).
// Numbered M010 because PR-3 (entity normalization) merged to main first and
// took M008 (entity_handles) + M009 (entity_merge_suggestions).
// One row per session revision, holding the target-agnostic, immutable distilled
// payload (spec §5, §6.2). PR-2 produces and persists this; the apply engine
// (PR-4) later consumes it to build target-specific apply plans. Never mutated
// after insert — hence the unique(revision_id). ttl_expires_at drives the
// consolidator's payload-TTL sweep (spec §4.3, distiller.payload_ttl_days,
// default 90 days after the session reaches `done`). restoration_map holds the
// reversible pre-LLM redaction mapping keyed by msg_id (spec §4.3), cleared on
// TTL alongside the payload. Migration-only (like M005/M007) — runMigrations
// runs on both fresh and upgraded databases.
const M010_DISTILLED_PAYLOAD = `
CREATE TABLE IF NOT EXISTS distilled_payload (
  id               SERIAL PRIMARY KEY,
  source_instance  TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  revision_id      INTEGER NOT NULL,
  content_hash     TEXT NOT NULL,
  payload          JSONB NOT NULL,
  restoration_map  JSONB,
  ttl_expires_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (revision_id)
);

CREATE INDEX IF NOT EXISTS idx_distilled_payload_lookup
  ON distilled_payload (source_instance, session_id);
CREATE INDEX IF NOT EXISTS idx_distilled_payload_ttl
  ON distilled_payload (ttl_expires_at) WHERE ttl_expires_at IS NOT NULL;
`;

// Migration 011: apply-engine backbone (extraction-quality-redesign PR-4).
// The three-layer apply data structure (spec §6.2) plus the two-layer ID
// provenance table (spec §6.1, §8):
//   - memory_contributions: source-signal → canonical-page contribution ledger.
//     Two-layer ID: contribution_id = hash(revision_id, type, normalized_topic)
//     is the PK (one raw material per distillation); signal_family_key =
//     hash(source_instance, session_id, type, normalized_topic) is the
//     cross-revision family, unique per (signal_family_key, revision_id). Every
//     canonical-page derivative (system-managed body, primary source, links,
//     tags, timeline) is rematerialized from the ACTIVE rows here. This table
//     doubles as the normalized provenance table (spec §8) via source_ref.
//   - apply_plan(payload_id, target): the candidate-selection result, one per
//     (payload, target). staging and production plans are independent.
//   - apply_attempt(plan_id, status): one row per apply of a plan.
//   - apply_mutation_journal: inverse records for NON-derived writes only
//     (spec §3.1 / §6.2) — a rollback safety net; derived writes are rebuilt by
//     rematerialize, so they are not journaled.
// Numbered M011 (M008/M009 = PR-3, M010 = PR-2). Migration-only, runs on both
// fresh and upgraded databases.
const M011_APPLY_ENGINE = `
CREATE TABLE IF NOT EXISTS memory_contributions (
  contribution_id   TEXT PRIMARY KEY,
  signal_family_key TEXT NOT NULL,
  canonical_page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  session_ref       TEXT NOT NULL,
  revision_id       INTEGER NOT NULL,
  authority         TEXT NOT NULL,
  signal_type       TEXT NOT NULL,
  normalized_topic  TEXT NOT NULL,
  signal            JSONB NOT NULL,
  source_ref        JSONB,
  evidence          JSONB,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  apply_attempt_id  INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signal_family_key, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_contributions_page
  ON memory_contributions (canonical_page_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_memory_contributions_family
  ON memory_contributions (signal_family_key);
CREATE INDEX IF NOT EXISTS idx_memory_contributions_attempt
  ON memory_contributions (apply_attempt_id);

CREATE TABLE IF NOT EXISTS apply_plan (
  id          SERIAL PRIMARY KEY,
  payload_id  INTEGER NOT NULL REFERENCES distilled_payload(id) ON DELETE CASCADE,
  target      TEXT NOT NULL CHECK (target IN ('staging','production')),
  plan        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payload_id, target)
);

CREATE TABLE IF NOT EXISTS apply_attempt (
  id           SERIAL PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES apply_plan(id) ON DELETE CASCADE,
  target       TEXT NOT NULL CHECK (target IN ('staging','production')),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','applied','failed','dead_letter')),
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_apply_attempt_plan ON apply_attempt (plan_id);

CREATE TABLE IF NOT EXISTS apply_mutation_journal (
  id               SERIAL PRIMARY KEY,
  apply_attempt_id INTEGER NOT NULL REFERENCES apply_attempt(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  kind             TEXT NOT NULL,
  inverse          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (apply_attempt_id, seq)
);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "lifecycle_columns", sql: M001_LIFECYCLE_COLUMNS },
  { version: 2, name: "provenance_columns", sql: M002_PROVENANCE_COLUMNS },
  { version: 3, name: "lifecycle_tier", sql: M003_LIFECYCLE_TIER },
  { version: 4, name: "identity_cache_nullable", sql: M004_IDENTITY_CACHE_NULLABLE },
  { version: 5, name: "person_behavior", sql: M005_PERSON_BEHAVIOR },
  { version: 6, name: "trgm_fts", sql: M006_TRGM_FTS },
  { version: 7, name: "agent_sessions", sql: M007_AGENT_SESSIONS },
  { version: 8, name: "entity_handles", sql: M008_ENTITY_HANDLES },
  { version: 9, name: "entity_merge_suggestions", sql: M009_ENTITY_MERGE_SUGGESTIONS },
  { version: 10, name: "distilled_payload", sql: M010_DISTILLED_PAYLOAD },
  { version: 11, name: "apply_engine", sql: M011_APPLY_ENGINE },
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
