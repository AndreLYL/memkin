CREATE EXTENSION IF NOT EXISTS vector;

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
  search_vector   TSVECTOR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pages_search_vector ON pages USING GIN (search_vector);
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
  search_vector   TSVECTOR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON content_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_search_vector ON content_chunks
  USING GIN (search_vector);

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

-- FTS Triggers
CREATE OR REPLACE FUNCTION update_page_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.compiled_truth, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_pages_search_vector'
  ) THEN
    CREATE TRIGGER trg_pages_search_vector
      BEFORE INSERT OR UPDATE ON pages
      FOR EACH ROW EXECUTE FUNCTION update_page_search_vector();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_chunk_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.chunk_text, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'chunk_search_vector_trigger'
  ) THEN
    CREATE TRIGGER chunk_search_vector_trigger
      BEFORE INSERT OR UPDATE OF chunk_text ON content_chunks
      FOR EACH ROW EXECUTE FUNCTION update_chunk_search_vector();
  END IF;
END $$;

-- Identity cache for person slug canonicalization
CREATE TABLE IF NOT EXISTS identity_cache (
  platform      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  display_name  TEXT NOT NULL,
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
