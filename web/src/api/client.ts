const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface Page {
  slug: string;
  title: string;
  type: string;
  compiled_truth: string;
  created_at: string;
  updated_at: string;
}

export interface StatsResponse {
  pages: number;
  chunks: number;
  embedded_chunks: number;
  links: number;
  pages_by_type: Record<string, number>;
}

export interface LinkRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
}

export interface ChunkRow {
  chunk_index: number;
  chunk_text: string;
  token_count: number;
  embedded_at: string | null;
}

export interface TimelineEntry {
  date: string;
  summary: string;
  detail: string | null;
  source: string | null;
}

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
}

export const api = {
  stats: () => fetchJSON<StatsResponse>("/stats"),

  pages: (opts?: { type?: string; limit?: number; sort?: string; order?: string }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set("type", opts.type);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.order) params.set("order", opts.order);
    const qs = params.toString();
    return fetchJSON<Page[]>(`/pages${qs ? `?${qs}` : ""}`);
  },

  pageBySlug: (slug: string) =>
    fetchJSON<Page>(`/pages/by-slug?slug=${encodeURIComponent(slug)}`),

  chunks: (slug: string) =>
    fetchJSON<ChunkRow[]>(`/chunks?slug=${encodeURIComponent(slug)}`),

  links: (slug: string) =>
    fetchJSON<LinkRow[]>(`/links?slug=${encodeURIComponent(slug)}`),

  backlinks: (slug: string) =>
    fetchJSON<LinkRow[]>(`/backlinks?slug=${encodeURIComponent(slug)}`),

  allLinks: () => fetchJSON<LinkRow[]>("/links/all"),

  tags: (slug: string) =>
    fetchJSON<string[]>(`/tags?slug=${encodeURIComponent(slug)}`),

  timeline: (slug: string) =>
    fetchJSON<TimelineEntry[]>(`/timeline?slug=${encodeURIComponent(slug)}`),

  query: (q: string) =>
    fetchJSON<SearchResult[]>("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q }),
    }),
};
