import type { ScoredHit } from "./recall-client.js";

// Gating + budget for UserPromptSubmit injection (Spec 13). Character budget,
// not tokens, to avoid a tokenizer dependency.
export const RECALL_TOP_K = 3;
export const RECALL_MIN_SCORE = 0.5;
export const INJECT_MAX_CHARS = 3000;

/** Render the top gated hits into an additionalContext string, or null if none qualify. */
export function renderInjection(hits: ScoredHit[]): string | null {
  const top = hits.filter((h) => h.score >= RECALL_MIN_SCORE).slice(0, RECALL_TOP_K);
  if (top.length === 0) return null;
  const lines = top.map((h) => {
    const title = h.title ? `${h.title}: ` : "";
    return `- [${h.slug}] ${title}${h.snippet}`.trimEnd();
  });
  const body = `Relevant memory from Memkin (cite [slug] if used):\n${lines.join("\n")}`;
  return body.length > INJECT_MAX_CHARS ? body.slice(0, INJECT_MAX_CHARS) : body;
}
