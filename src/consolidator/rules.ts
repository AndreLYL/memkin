// Types whose content must never be merged or rewritten by the Consolidator.
// Decisions preserve their "why"; references are permanent bookmarks; entity pages are anchors.
export const NEVER_COMPRESS_TYPES = new Set([
  "decision",
  "reference",
  "entity",
  "person",
  "project",
  "organization",
  "tool",
  "concept",
]);

export function canCompress(type: string): boolean {
  return !NEVER_COMPRESS_TYPES.has(type);
}

// Age (in days) after which a hot page transitions to warm.
// Matches halflife_days from Spec 1: the half-life point is the right moment to archive.
// NULL = never automatically expires (open tasks, references, entity pages).
export const HOT_DAYS: Record<string, number | null> = {
  decision: 90,
  task: 90, // done tasks get expires_at=NOW() immediately; open tasks: null
  knowledge: 365,
  discovery: 90,
  "discovery-pattern": 90,
  "discovery-insight": 90,
  "discovery-preference": 90,
  preference: 90,
  reference: null,
  entity: null,
  person: null,
  project: null,
  organization: null,
  tool: null,
  concept: null,
};

// Minimum age (days from created_at) for a warm page to be eligible for cold compression.
export const WARM_TO_COLD_DAYS: Record<string, number | null> = {
  decision: null,
  reference: null,
  entity: null,
  person: null,
  project: null,
  organization: null,
  tool: null,
  concept: null,
  task: 365,
  knowledge: 730,
  discovery: 365,
  "discovery-pattern": 365,
  "discovery-insight": 365,
  preference: 365,
};
