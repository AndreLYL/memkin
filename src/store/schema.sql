CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS pages (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  compiled_truth  TEXT NOT NULL DEFAULT '',
  frontmatter     JSONB NOT NULL DEFAULT '{}',
  content_hash    TEXT,
  search_vector   TSVECTOR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pages_search_vector ON pages USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS content_chunks (
  id              SERIAL PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  UNIQUE(page_id, chunk_index),
  chunk_text      TEXT NOT NULL,
  chunk_source    TEXT NOT NULL DEFAULT 'compiled_truth',
  token_count     INTEGER,
  embedding       vector(768),
  model           TEXT NOT NULL DEFAULT 'nomic-embed-text',
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

DROP TRIGGER IF EXISTS trg_pages_search_vector ON pages;
CREATE TRIGGER trg_pages_search_vector
  BEFORE INSERT OR UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION update_page_search_vector();

CREATE OR REPLACE FUNCTION update_chunk_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.chunk_text, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunk_search_vector_trigger ON content_chunks;
CREATE TRIGGER chunk_search_vector_trigger
  BEFORE INSERT OR UPDATE OF chunk_text ON content_chunks
  FOR EACH ROW EXECUTE FUNCTION update_chunk_search_vector();
