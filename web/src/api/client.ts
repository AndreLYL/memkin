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
  highlights: string[];
  score: number;
}

export interface DaemonStatus {
  running: boolean;
  uptime_seconds: number | null;
  last_run: string | null;
  next_scheduled: string | null;
}

export interface SourceStatus {
  name: string;
  platform: string;
  status: "healthy" | "error" | "never_run";
  last_sync: string | null;
  last_error: string | null;
  signals_total: number;
}

export interface HealthResponse {
  status: string;
  pages: number;
  chunks: number;
  daemon: DaemonStatus;
  sources: SourceStatus[];
}

export const api = {
  stats: () => fetchJSON<StatsResponse>("/stats"),

  health: () => fetchJSON<HealthResponse>("/health"),

  extract: (source?: string) =>
    fetchJSON<{ started: boolean; source: string }>("/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(source ? { source } : {}),
    }),

  timelineFeed: (opts?: {
    from?: string; to?: string; group_by?: string;
    type?: string; platform?: string; exclude_types?: string;
    cursor?: string; limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.group_by) params.set("group_by", opts.group_by);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.platform) params.set("platform", opts.platform);
    if (opts?.exclude_types) params.set("exclude_types", opts.exclude_types);
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return fetchJSON<{ days: unknown[]; next_cursor: string | null }>(
      `/timeline/feed${qs ? `?${qs}` : ""}`,
    );
  },

  pages: (opts?: { type?: string; exclude_types?: string; limit?: number; sort?: string; order?: string }) => {
    const params = new URLSearchParams();
    if (opts?.type) params.set("type", opts.type);
    if (opts?.exclude_types) params.set("exclude_types", opts.exclude_types);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.sort) params.set("sort", opts.sort);
    if (opts?.order) params.set("order", opts.order);
    const qs = params.toString();
    return fetchJSON<Page[]>(`/pages${qs ? `?${qs}` : ""}`);
  },

  pageBySlug: (slug: string, include?: string) => {
    const params = new URLSearchParams({ slug });
    if (include) params.set("include", include);
    return fetchJSON<Page & { links?: unknown[]; backlinks?: unknown[]; timeline?: unknown[] }>(
      `/pages/by-slug?${params.toString()}`,
    );
  },

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

  search: (q: string, opts?: { type?: string; from?: string; to?: string; platform?: string; exclude_types?: string; limit?: number }) => {
    const params = new URLSearchParams({ q });
    if (opts?.type) params.set("type", opts.type);
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    if (opts?.platform) params.set("platform", opts.platform);
    if (opts?.exclude_types) params.set("exclude_types", opts.exclude_types);
    if (opts?.limit) params.set("limit", String(opts.limit));
    return fetchJSON<SearchResult[]>(`/search?${params.toString()}`);
  },

  query: (q: string, opts?: { type?: string; from?: string; to?: string; platform?: string; exclude_types?: string; limit?: number }) =>
    fetchJSON<SearchResult[]>("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, ...opts }),
    }),
};
