-- Backfills the provenance/source_hash columns introduced by the "signal
-- fidelity" feature (commit bef3a95) for databases that already ran
-- migration 001 before schema.sql was updated to include them.
ALTER TABLE links ADD COLUMN IF NOT EXISTS provenance JSONB;
ALTER TABLE links ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS provenance JSONB;
