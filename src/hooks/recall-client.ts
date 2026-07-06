// Fast, zero-cost recall for the UserPromptSubmit hook.
//
// Prefers the running `memkin serve` REST endpoint (GET /api/search), which is
// FTS-only (SearchEngine.search → to_tsquery, no embeddings) and warm, and which
// also avoids contending for the PGLite single-writer lock. Falls back to a
// direct FTS store search when serve is not running. NEVER use the hybrid
// /api/query (it triggers embeddings).

export interface ScoredHit {
  slug: string;
  score: number;
  snippet: string;
  title?: string;
}

export interface FtsStore {
  search: (query: string, opts: { limit: number }) => Promise<unknown[]>;
}

export interface RecallDeps {
  port?: number;
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  store?: FtsStore;
}

function normalize(rows: unknown): ScoredHit[] {
  if (!Array.isArray(rows)) return [];
  const hits: ScoredHit[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const slug = typeof row.slug === "string" ? row.slug : "";
    if (!slug) continue;
    hits.push({
      slug,
      score: typeof row.score === "number" ? row.score : 0,
      snippet: typeof row.snippet === "string" ? row.snippet : "",
      title: typeof row.title === "string" ? row.title : undefined,
    });
  }
  return hits;
}

export async function recall(query: string, deps: RecallDeps = {}): Promise<ScoredHit[]> {
  const limit = deps.limit ?? 5;
  const port = deps.port ?? 3927;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as RecallDeps["fetchImpl"]);

  if (fetchImpl) {
    try {
      const url = `http://localhost:${port}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      const signal =
        typeof AbortSignal?.timeout === "function"
          ? AbortSignal.timeout(deps.timeoutMs ?? 800)
          : undefined;
      const res = await fetchImpl(url, signal ? { signal } : undefined);
      if (res.ok) return normalize(await res.json());
    } catch {
      // serve not running / timeout → fall through to direct store
    }
  }

  if (deps.store) {
    try {
      return normalize(await deps.store.search(query, { limit }));
    } catch {
      return [];
    }
  }
  return [];
}
