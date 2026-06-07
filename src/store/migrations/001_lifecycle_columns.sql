-- Migration 001: lifecycle metadata + preference type promotion
--
-- Adds halflife_days to pages (drives Spec 2's hot/warm/cold rotation —
-- a page past its halflife has "decayed" past the importance-halving point,
-- the natural moment to demote it from hot to warm).
--
-- Also remaps the legacy discovery-preference subtype to a first-class
-- `preference` page type (Spec 1 promotes preferences out of Discovery.type).

ALTER TABLE pages ADD COLUMN IF NOT EXISTS halflife_days INTEGER;

-- Promote discovery-preference pages to first-class preference type.
-- Must run BEFORE the backfill below so these rows pick up the
-- preference halflife (90), not the discovery-* halflife (also 90 here,
-- but keeping the order correct matters if the values ever diverge).
UPDATE pages SET type = 'preference' WHERE type = 'discovery-preference';

-- Backfill halflife_days for existing signal pages, by type.
-- Types not listed here (entity pages: person/project/organization/tool/concept,
-- and the not-yet-existing reference type) keep halflife_days = NULL,
-- meaning "never auto-expires" — see spec §4.3.
UPDATE pages SET halflife_days = 90
  WHERE type IN ('decision', 'task', 'preference') OR type LIKE 'discovery-%';
UPDATE pages SET halflife_days = 365
  WHERE type = 'knowledge';
