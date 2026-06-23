/** Split a query into terms on whitespace; drop empties. Intra-term chars (e.g. "gpt-4") are kept. */
export function splitTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** Escape ILIKE wildcards for use with `ESCAPE '\'`. Order matters: backslash first. */
export function escapeIlikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Build an AND-of-OR `ILIKE` fragment for trigram substring recall across `columns`.
 * Pushes one `%term%` param per term into `params` (continuing from its current length)
 * and returns the SQL fragment, or null if there are no terms.
 */
export function buildTrgmConditions(
  terms: string[],
  columns: string[],
  params: unknown[],
): string | null {
  if (terms.length === 0) return null;
  const groups: string[] = [];
  for (const term of terms) {
    params.push(`%${escapeIlikeTerm(term)}%`);
    const idx = params.length;
    const ors = columns.map((c) => `${c} ILIKE $${idx} ESCAPE '\\'`);
    groups.push(`(${ors.join(" OR ")})`);
  }
  return groups.join(" AND ");
}

/** Case-insensitive snippet around the first matching term, wrapping the match in `**…**`. */
export function buildSnippet(text: string, terms: string[], window = 40): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  let pos = -1;
  let matchLen = 0;
  for (const term of terms) {
    if (!term) continue;
    const i = lower.indexOf(term.toLowerCase());
    if (i !== -1 && (pos === -1 || i < pos)) {
      pos = i;
      matchLen = term.length;
    }
  }
  if (pos === -1) return text.slice(0, window * 2);
  const start = Math.max(0, pos - window);
  const end = Math.min(text.length, pos + matchLen + window);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const before = text.slice(start, pos);
  const match = text.slice(pos, pos + matchLen);
  const after = text.slice(pos + matchLen, end);
  return `${prefix}${before}**${match}**${after}${suffix}`;
}
