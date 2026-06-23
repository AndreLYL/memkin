import type { AssembledCandidate, Citation } from "./types.js";

const CITATION_RE = /\[(\d+)\]/g;

/**
 * Finalize citations (Spec 7 §五).
 * - Extracts inline [n] markers from the answer.
 * - Strips pseudo-references outside 1..N (both from the answer text and from citations).
 * - Returns citations only for candidates actually referenced (deduped, in ascending order).
 */
export function finalize(
  answer: string,
  candidates: AssembledCandidate[],
): { answer: string; citations: Citation[] } {
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const referenced = new Set<number>();

  // Strip pseudo-refs; collect valid ones.
  const cleaned = answer.replace(CITATION_RE, (match, digits) => {
    const ref = Number(digits);
    if (byRef.has(ref)) {
      referenced.add(ref);
      return match;
    }
    return "";
  });

  const citations: Citation[] = [...referenced]
    .sort((a, b) => a - b)
    .map((ref) => {
      const c = byRef.get(ref) as AssembledCandidate;
      return { ref: c.ref, slug: c.slug, title: c.title, source: c.source, date: c.date };
    });

  return { answer: cleaned, citations };
}
