/** M013: additive tables on the same engine; no external graph service. */
export const PERSON_CRM_SQL = `
CREATE TABLE IF NOT EXISTS crm_people (
  person_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE RESTRICT,
  profile JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS crm_records (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','voice','import')),
  captured_at TIMESTAMPTZ NOT NULL,
  captured_at_input TEXT NOT NULL,
  timezone TEXT NOT NULL,
  external_id TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source,external_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_records_captured ON crm_records(captured_at);
CREATE TABLE IF NOT EXISTS crm_record_people (
  record_id TEXT NOT NULL REFERENCES crm_records(id),
  person_id INTEGER NOT NULL REFERENCES crm_people(person_id),
  PRIMARY KEY(record_id,person_id)
);
CREATE TABLE IF NOT EXISTS crm_proposals (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES crm_records(id),
  data JSONB NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('manual','ai')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied')),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS crm_entries (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES crm_records(id),
  proposal_id TEXT NOT NULL REFERENCES crm_proposals(id),
  kind TEXT NOT NULL CHECK (kind IN ('interaction','fact','relationship')),
  data JSONB NOT NULL,
  occurred_start TIMESTAMPTZ,
  occurred_end TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_entries_time ON crm_entries(occurred_start);
CREATE INDEX IF NOT EXISTS idx_crm_entries_record ON crm_entries(record_id);
CREATE TABLE IF NOT EXISTS crm_entry_people (
  entry_id TEXT NOT NULL REFERENCES crm_entries(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES crm_people(person_id),
  role TEXT NOT NULL CHECK(role IN ('participant','mentioned','subject','related')),
  PRIMARY KEY(entry_id,person_id,role)
);
CREATE INDEX IF NOT EXISTS idx_crm_entry_people_person ON crm_entry_people(person_id);
CREATE TABLE IF NOT EXISTS crm_revisions (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('person','entry')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  before_data JSONB,
  after_data JSONB NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(entity_type,entity_id,revision)
);
CREATE OR REPLACE FUNCTION crm_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'CRM source records and revision history are immutable'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS crm_records_immutable ON crm_records;
CREATE TRIGGER crm_records_immutable BEFORE UPDATE OR DELETE ON crm_records
FOR EACH ROW EXECUTE FUNCTION crm_immutable();
DROP TRIGGER IF EXISTS crm_revisions_immutable ON crm_revisions;
CREATE TRIGGER crm_revisions_immutable BEFORE UPDATE OR DELETE ON crm_revisions
FOR EACH ROW EXECUTE FUNCTION crm_immutable();
CREATE OR REPLACE FUNCTION crm_protect_page() RETURNS trigger AS $$
BEGIN
  IF current_setting('memkin.crm_write',true) = 'on' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_people WHERE person_id=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM person pages cannot be deleted through generic tools'; END IF;
    IF NEW.type <> OLD.type OR NEW.title <> OLD.title OR
       substring(NEW.compiled_truth from '(?s)<!-- memkin:crm:start -->.*<!-- memkin:crm:end -->')
       IS DISTINCT FROM substring(OLD.compiled_truth from '(?s)<!-- memkin:crm:start -->.*<!-- memkin:crm:end -->')
    THEN RAISE EXCEPTION 'Use CRM tools to edit structured person data; preserve the generated block'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS crm_pages_protected ON pages;
CREATE TRIGGER crm_pages_protected BEFORE UPDATE OR DELETE ON pages
FOR EACH ROW EXECUTE FUNCTION crm_protect_page();
`;
