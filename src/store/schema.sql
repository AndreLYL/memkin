CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS pages (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  compiled_truth  TEXT NOT NULL DEFAULT '',
  frontmatter     JSONB NOT NULL DEFAULT '{}',
  content_hash    TEXT,
  halflife_days   INTEGER,
  tier            TEXT NOT NULL DEFAULT 'hot',
  expires_at      TIMESTAMPTZ,
  consolidated_into INTEGER REFERENCES pages(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pages_title_trgm ON pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_compiled_truth_trgm ON pages USING gin (compiled_truth gin_trgm_ops);
-- idx_pages_tier and idx_pages_expires_at are created by M003 lifecycle_tier migration,
-- which is the only place that guarantees the tier/expires_at columns exist on upgrade.

CREATE TABLE IF NOT EXISTS content_chunks (
  id              SERIAL PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  UNIQUE(page_id, chunk_index),
  chunk_text      TEXT NOT NULL,
  chunk_source    TEXT NOT NULL DEFAULT 'compiled_truth',
  token_count     INTEGER,
  embedding       vector(__EMBEDDING_DIM__),
  model           TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  embedded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON content_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_text_trgm ON content_chunks USING gin (chunk_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS links (
  id              SERIAL PRIMARY KEY,
  from_page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_page_id      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  link_type       TEXT NOT NULL DEFAULT '',
  context         TEXT NOT NULL DEFAULT '',
  provenance      JSONB,
  source_hash     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_page_id, to_page_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_links_from ON links (from_page_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links (to_page_id);

CREATE TABLE IF NOT EXISTS tags (
  id              SERIAL PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  UNIQUE(page_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id              SERIAL PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  summary         TEXT NOT NULL,
  detail          TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT '',
  provenance      JSONB,
  tier            TEXT NOT NULL DEFAULT 'hot',
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(page_id, date, summary)
);

-- Identity cache for person slug canonicalization
-- identity_cache doubles as the person slug canonicalization store via
-- platform = 'canonical':
--   external_id  = model-produced slug or display name
--   display_name = canonical person slug (e.g. 'person/wang-jiandu')
--   slug_hint    = original entity.name (used for collision detection)
CREATE TABLE IF NOT EXISTS identity_cache (
  platform      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  display_name  TEXT,
  slug_hint     TEXT,
  resolved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, external_id)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'identity_cache' AND column_name = 'slug_hint'
  ) THEN
    ALTER TABLE identity_cache ADD COLUMN slug_hint TEXT;
  END IF;
END $$;

-- person_handles: the typed alias layer (Layer 1 of person identity).
-- Maps any "handle" by which a person is known to the canonical person page
-- slug. A handle is (kind, value); the pair is unique, so one handle resolves
-- to exactly one person. Merging/aliasing is explicit (see core/person-identity).
--   kind     = 'feishu_open_id' | 'email' | 'name' | 'nickname' | 'slug'
--   value    = canonicalized handle value (lowercased / whitespace-collapsed)
--   strength = 'strong' (auto-resolvable: open_id/email/name/slug)
--            | 'weak'   (nickname/花名 — only created via explicit link)
CREATE TABLE IF NOT EXISTS person_handles (
  kind            TEXT NOT NULL,
  value           TEXT NOT NULL,
  canonical_slug  TEXT NOT NULL,
  strength        TEXT NOT NULL DEFAULT 'strong',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, value)
);

CREATE INDEX IF NOT EXISTS idx_person_handles_slug ON person_handles (canonical_slug);

-- Engine/embedding metadata (key-value). Used for embedding fingerprint consistency.
CREATE TABLE IF NOT EXISTS memkin_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
