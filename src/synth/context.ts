import type { RawCandidate } from "./scope.js";
import type { AssembledContext, SynthScope } from "./types.js";

/**
 * Token budget for assembled candidates (Spec 9 §6). `limit` only caps how many
 * candidates are retrieved; here we truncate the retrieved set to a total token
 * budget so a busy day never dumps hundreds of signals into the LLM. We use a
 * cheap chars≈tokens heuristic (CJK-heavy text → ~1 token/char is a safe upper
 * bound) and accumulate in order, stopping once the budget is exceeded.
 */
const TOKEN_BUDGET = 12_000;
const CHARS_PER_TOKEN = 1;

function estimateTokens(c: RawCandidate): number {
  return Math.ceil((c.title.length + c.text.length) / CHARS_PER_TOKEN);
}

/**
 * Drop exact-duplicate candidates, keeping the first occurrence (Spec 9 §6
 * primary-key dedupe). Keyed on `slug::text` (not slug alone) so that
 * entity-scope retrieval, which emits every timeline entry under the same
 * `slug = scope.entity`, is not collapsed to a single entry. Matches the
 * composite key used by scope.ts's own dedupe.
 */
function dedupeBySlug(candidates: RawCandidate[]): RawCandidate[] {
  const seen = new Set<string>();
  const out: RawCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.slug}::${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Accumulate candidates in order until the token budget is reached. Always keeps ≥1. */
function truncateToBudget(candidates: RawCandidate[]): RawCandidate[] {
  const out: RawCandidate[] = [];
  let used = 0;
  for (const c of candidates) {
    const cost = estimateTokens(c);
    if (out.length > 0 && used + cost > TOKEN_BUDGET) break;
    out.push(c);
    used += cost;
  }
  return out;
}

/**
 * Assemble retrieved candidates into a numbered AssembledContext (Spec 7 §3.3 step 5).
 * Dedupes by slug, truncates to a token budget (Spec 9 §6), assigns ref=1..N (in
 * order), and derives latestDate=max(date). pinnedContext is left undefined;
 * intents may set it via the buildPinnedContext hook.
 */
export function assemble(scope: SynthScope, candidates: RawCandidate[]): AssembledContext {
  const deduped = dedupeBySlug(candidates);
  const budgeted = truncateToBudget(deduped);
  const numbered = budgeted.map((c, i) => ({ ...c, ref: i + 1 }));

  let latestDate: string | undefined;
  for (const c of numbered) {
    if (c.date && (!latestDate || c.date > latestDate)) {
      latestDate = c.date;
    }
  }

  return {
    scope,
    candidates: numbered,
    latestDate,
  };
}
