// src/store/source-filter.ts
//
// Source filtering against active contributions (spec §8, PR-4).
//
// The multi-source truth lives in memory_contributions, not in the frontmatter
// (which keeps only a singular `source` = primary, for display). Filtering by a
// NON-primary platform / source_type / channel would MISS multi-source pages if
// it read only the frontmatter primary. So every source filter now matches
// against the page's ACTIVE contributions.
//
// Legacy pages that predate the apply engine have no contributions yet; for
// them we fall back to the frontmatter primary so existing retrieval keeps
// working during the transition. Concretely, a page matches a source filter
// when EITHER an active contribution matches, OR (the page has no active
// contributions AND) the frontmatter primary matches.

/**
 * Build a boolean SQL condition that matches when an active contribution of the
 * page satisfies `contribCond`, or — only when the page has no active
 * contributions — the frontmatter `fallbackCond` matches.
 *
 * `contribCond` is evaluated against alias `mc` (memory_contributions);
 * `fallbackCond` against whatever page/entry aliases the caller already uses.
 * Both branches must reference the SAME bound parameter so the caller pushes it
 * exactly once.
 */
export function sourceFilterCondition(
  pageIdExpr: string,
  contribCond: string,
  fallbackCond: string,
): string {
  const base = `SELECT 1 FROM memory_contributions mc WHERE mc.canonical_page_id = ${pageIdExpr} AND mc.active`;
  return `(EXISTS (${base} AND (${contribCond})) OR (NOT EXISTS (${base}) AND (${fallbackCond})))`;
}

/**
 * A correlated subquery returning the primary active contribution's source_ref
 * (first user_confirmed, else earliest) as JSONB, for use in COALESCE(...) so
 * derived timestamps/sources come from contributions with a frontmatter
 * fallback. Alias-safe: pass the page id expression.
 */
export function primaryContribSourceExpr(pageIdExpr: string): string {
  return `(
    SELECT mc.source_ref FROM memory_contributions mc
     WHERE mc.canonical_page_id = ${pageIdExpr} AND mc.active
     ORDER BY (mc.authority = 'user_confirmed') DESC, mc.created_at ASC
     LIMIT 1
  )`;
}
