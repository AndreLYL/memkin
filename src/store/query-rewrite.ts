import type { LLMProvider } from "../extractors/providers/types.js";

/**
 * Default English stopword set. Intentionally small and conservative — we only
 * drop function words that almost never carry retrieval signal. CJK recall is
 * already covered by tsvector('simple') + vectors, so no tokenizer is used here
 * (Spec 10 §5: zero-dependency, rule-based; no jieba/@node-rs native bindings).
 */
const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "and",
  "or",
  "what",
  "which",
  "that",
  "this",
  "with",
  "do",
  "does",
]);

export interface QueryRewriteOpts {
  /** abbreviation/synonym expansion map; key term -> extra terms appended for recall. */
  synonyms?: Record<string, string[]>;
  /** override the default stopword set. */
  stopwords?: Iterable<string>;
  /** optional LLM rewrite; only runs when enabled is true (default off). */
  llm?: {
    enabled: boolean;
    provider: LLMProvider;
  };
}

const LLM_SYSTEM_PROMPT =
  "You expand a search query into a few extra keywords that improve recall. " +
  "Return ONLY space-separated keywords, no punctuation, no explanation.";

function ruleRewrite(query: string, opts?: QueryRewriteOpts): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return "";

  const stopwords = opts?.stopwords ? new Set(opts.stopwords) : DEFAULT_STOPWORDS;
  const synonyms = opts?.synonyms ?? {};

  const tokens = normalized.split(" ");
  const kept = tokens.filter((t) => !stopwords.has(t.toLowerCase()));

  // If stopword filtering removed everything, fall back to the normalized query
  // so retrieval still has terms to match.
  const base = kept.length > 0 ? kept : tokens;

  const result: string[] = [];
  const seen = new Set<string>();
  const push = (term: string) => {
    const key = term.toLowerCase();
    if (!term || seen.has(key)) return;
    seen.add(key);
    result.push(term);
  };

  for (const term of base) {
    push(term);
    const expansions = synonyms[term.toLowerCase()];
    if (expansions) {
      for (const exp of expansions) push(exp);
    }
  }

  return result.join(" ");
}

/**
 * Rewrite a query before retrieval (Spec 10 §5). Affects recall only; does not
 * change the public return shape.
 *
 * Synchronous (returns a string) for the rule-based path. When `opts.llm.enabled`
 * is true it returns a Promise that additionally merges LLM-suggested keywords.
 * When LLM is disabled (default), the provider is never called.
 */
export function rewriteQuery(query: string, opts?: QueryRewriteOpts): string;
export function rewriteQuery(
  query: string,
  opts: QueryRewriteOpts & { llm: { enabled: true; provider: LLMProvider } },
): Promise<string>;
export function rewriteQuery(query: string, opts?: QueryRewriteOpts): string | Promise<string> {
  const ruleResult = ruleRewrite(query, opts);

  if (!opts?.llm?.enabled) {
    return ruleResult;
  }

  const provider = opts.llm.provider;
  return (async () => {
    let extra = "";
    try {
      extra = await provider.chat([
        { role: "system", content: LLM_SYSTEM_PROMPT },
        { role: "user", content: query },
      ]);
    } catch {
      // LLM failure must never break retrieval; fall back to the rule result.
      return ruleResult;
    }

    const merged: string[] = [];
    const seen = new Set<string>();
    for (const term of `${ruleResult} ${extra}`.split(/\s+/)) {
      const t = term.replace(/[^\p{L}\p{N}_-]/gu, "");
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    return merged.join(" ");
  })();
}
