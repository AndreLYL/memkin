import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { SignalCard } from "../components/shared/SignalCard";
import { EmptyState } from "../components/shared/EmptyState";

type SearchMode = "semantic" | "keyword";

const HISTORY_KEY = "memoark-search-history";
const MAX_HISTORY = 10;

const TYPE_ORDER = ["person", "project", "decision", "knowledge", "task", "tool", "concept", "organization"];

const TIME_OPTIONS = [
  { label: "All time", value: "" },
  { label: "Today", value: "1d" },
  { label: "Last 7d", value: "7d" },
  { label: "Last 30d", value: "30d" },
];

function getTimeRange(value: string): { from?: string; to?: string } {
  if (!value) return {};
  const days = value === "1d" ? 1 : value === "7d" ? 7 : 30;
  const from = new Date(Date.now() - days * 86400000).toISOString();
  return { from };
}

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveToHistory(query: string) {
  const history = loadHistory().filter((h) => h !== query);
  history.unshift(query);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const initialQuery = searchParams.get("q") ?? "";
  const initialMode = (searchParams.get("mode") as SearchMode) ?? "semantic";
  const initialType = searchParams.get("type") ?? "";

  const [input, setInput] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [typeFilter, setTypeFilter] = useState<string[]>(initialType ? initialType.split(",") : []);
  const [timeRange, setTimeRange] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(input.trim());
      if (input.trim()) saveToHistory(input.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (debouncedQuery) params.q = debouncedQuery;
    if (mode !== "semantic") params.mode = mode;
    if (typeFilter.length) params.type = typeFilter.join(",");
    if (timeRange) params.time = timeRange;
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, mode, typeFilter, timeRange, setSearchParams]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { from } = getTimeRange(timeRange);

  const { data: results, isLoading } = useQuery({
    queryKey: ["search", debouncedQuery, mode, typeFilter, timeRange],
    queryFn: async () => {
      if (!debouncedQuery) return [];
      const opts: any = { limit: 50 };
      if (typeFilter.length) opts.type = typeFilter.join(",");
      if (from) opts.from = from;
      if (mode === "semantic") {
        return api.query(debouncedQuery, opts);
      }
      return api.search(debouncedQuery, opts);
    },
    enabled: debouncedQuery.length > 0,
  });

  const grouped = useMemo(() => {
    if (!results || results.length === 0) return [];
    const groups = new Map<string, typeof results>();
    for (const r of results) {
      const t = r.type ?? "unknown";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(r);
    }
    return TYPE_ORDER
      .filter((t) => groups.has(t))
      .map((t) => ({ type: t, items: groups.get(t)! }))
      .concat(
        [...groups.entries()]
          .filter(([t]) => !TYPE_ORDER.includes(t))
          .map(([type, items]) => ({ type, items })),
      );
  }, [results]);

  const toggleType = (type: string) => {
    setTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const history = loadHistory();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold font-serif text-fg-default">Search</h1>

      <div className="relative">
        <input
          ref={inputRef}
          className="w-full bg-bg-surface border border-border-default rounded-lg px-4 py-3 text-sm text-fg-default placeholder:text-fg-subtle focus:outline-none focus:border-accent"
          placeholder="Search your memory... (press / to focus)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-bg-surface border border-border-default rounded-md p-0.5">
          <button
            onClick={() => setMode("semantic")}
            className={`px-2 py-0.5 rounded text-xs ${mode === "semantic" ? "bg-bg-overlay text-fg-default" : "text-fg-subtle"}`}
          >Semantic</button>
          <button
            onClick={() => setMode("keyword")}
            className={`px-2 py-0.5 rounded text-xs ${mode === "keyword" ? "bg-bg-overlay text-fg-default" : "text-fg-subtle"}`}
          >Keyword</button>
        </div>

        {TYPE_ORDER.slice(0, 6).map((t) => (
          <button
            key={t}
            onClick={() => toggleType(t)}
            className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
              typeFilter.includes(t) || typeFilter.length === 0
                ? "border-border-default bg-bg-surface text-fg-default"
                : "border-transparent text-fg-subtle opacity-50"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}

        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="bg-bg-surface border border-border-default rounded px-2 py-1 text-xs text-fg-default"
        >
          {TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {isLoading && <div className="text-fg-muted text-center py-8">Searching...</div>}

        {!debouncedQuery && !isLoading && (
          <div className="space-y-3">
            {history.length > 0 && (
              <div>
                <h3 className="text-xs text-fg-subtle mb-2">Recent searches</h3>
                <div className="flex flex-wrap gap-2">
                  {history.map((h) => (
                    <button
                      key={h}
                      onClick={() => setInput(h)}
                      className="px-2 py-1 bg-bg-surface border border-border-default rounded text-xs text-fg-subtle hover:text-fg-default"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <EmptyState title="Search your memory" description="Type a query to search across all signals" />
          </div>
        )}

        {debouncedQuery && results && results.length === 0 && !isLoading && (
          <EmptyState title="No results" description={`Nothing found for "${debouncedQuery}"`} />
        )}

        {grouped.length > 0 && (
          <div className="space-y-4">
            <div className="text-xs text-fg-subtle">
              Found {results!.length} result{results!.length !== 1 ? "s" : ""}
            </div>
            {grouped.map(({ type, items }) => (
              <div key={type}>
                <h3 className="text-sm font-medium text-fg-default mb-2 flex items-center gap-2">
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                  <span className="text-xs text-fg-subtle">({items.length})</span>
                </h3>
                <div className="space-y-1.5 pl-2">
                  {items.map((r) => (
                    <SignalCard
                      key={r.slug}
                      slug={r.slug}
                      type={r.type}
                      title={r.title ?? r.slug}
                      snippet={r.snippet}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
