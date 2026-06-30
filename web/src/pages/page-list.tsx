import { useState, useMemo } from "react";
import { Link } from "react-router";
import { Users, FolderOpen, Zap, BookOpen, CheckSquare, Layers, Clock } from "lucide-react";
import { usePages } from "../hooks/use-pages";

const TYPE_FILTERS = ["all", "person", "project", "decision", "session", "other"];

const TYPE_DOT_COLORS: Record<string, string> = {
  person: "bg-person",
  project: "bg-project",
  decision: "bg-decision",
  session: "bg-session",
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  person: "text-person border-person/30",
  project: "text-project border-project/30",
  decision: "text-decision border-decision/30",
  session: "text-session border-session/30",
  other: "text-fg-muted border-border-default",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  person: Users,
  project: FolderOpen,
  decision: Zap,
  session: Layers,
  other: BookOpen,
};

function TypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICONS[type] ?? BookOpen;
  return <Icon size={12} strokeWidth={1.75} className="opacity-60" />;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const FILTER_ACTIVE = "bg-project/10 border-project/40 text-project";
const FILTER_IDLE = "border-border-default text-fg-muted hover:text-fg-default hover:border-border-muted";

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

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh] text-fg-muted">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="font-serif text-xl font-semibold text-fg-default mb-6">Pages</h1>

      <input
        className="w-full bg-bg-surface border border-border-default rounded-lg px-4 py-2.5 text-sm text-fg-default placeholder:text-fg-subtle mb-4 focus:outline-none focus:border-accent/50 transition-colors"
        placeholder="Filter pages..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              typeFilter === t ? FILTER_ACTIVE : FILTER_IDLE
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
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-surface shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(43,37,33,0.06),0_8px_20px_rgba(43,37,33,0.05)] transition group"
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT_COLORS[page.type] ?? "bg-task"}`} />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-fg-default group-hover:text-accent transition-colors">{page.slug}</span>
              {page.title !== page.slug && <span className="text-xs text-fg-muted ml-2">{page.title}</span>}
            </div>
            <span className={`text-[10px] border rounded px-1.5 py-0.5 flex items-center gap-1 ${TYPE_BADGE_COLORS[page.type] ?? "text-fg-muted border-border-default"}`}>
              <TypeIcon type={page.type} />
              {page.type}
            </span>
            <span className="text-xs text-fg-muted flex items-center gap-1">
              <Clock size={10} strokeWidth={1.75} className="opacity-60" />
              {timeAgo(page.updated_at)}
            </span>
          </Link>
        ))}
        {filtered.length === 0 && <div className="text-center text-fg-muted py-12">No pages found</div>}
      </div>
    </div>
  );
}
