import { useState, useMemo } from "react";
import { Link } from "react-router";
import { usePages } from "../hooks/use-pages";

const TYPE_FILTERS = ["all", "person", "project", "decision", "session", "other"];
const TYPE_COLORS: Record<string, string> = {
  person: "bg-neon-cyan",
  project: "bg-neon-purple",
  decision: "bg-neon-green",
  session: "bg-neon-orange",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PageList() {
  const { data: pages, isLoading } = usePages({ limit: 0 });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = useMemo(() => {
    if (!pages) return [];
    return pages.filter((p) => {
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (search && !p.slug.includes(search) && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [pages, search, typeFilter]);

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh] text-muted">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-100 mb-6">Pages</h1>

      <input
        className="w-full bg-card-bg border border-border rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-muted mb-4 focus:outline-none focus:border-neon-purple/50"
        placeholder="Filter pages..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              typeFilter === t
                ? "bg-neon-purple/20 border-neon-purple/50 text-neon-purple"
                : "border-border text-muted hover:text-gray-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {filtered.map((page) => (
          <Link
            key={page.slug}
            to={`/entity/${encodeURIComponent(page.slug)}`}
            className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-card-bg transition-colors group"
          >
            <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[page.type] ?? "bg-neon-pink"} shadow-[0_0_6px_currentColor]`} />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-200 group-hover:text-neon-purple transition-colors">{page.slug}</span>
              {page.title !== page.slug && <span className="text-xs text-muted ml-2">{page.title}</span>}
            </div>
            <span className="text-[10px] text-neon-purple/60 border border-neon-purple/20 rounded px-1.5 py-0.5">{page.type}</span>
            <span className="text-xs text-muted">{timeAgo(page.updated_at)}</span>
          </Link>
        ))}
        {filtered.length === 0 && <div className="text-center text-muted py-12">No pages found</div>}
      </div>
    </div>
  );
}
