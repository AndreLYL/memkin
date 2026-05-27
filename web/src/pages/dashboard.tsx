import { Link } from "react-router";
import { useStats } from "../hooks/use-stats";
import { usePages } from "../hooks/use-pages";
import { StatCard } from "../components/stats/stat-card";
import { TypeChart } from "../components/stats/type-chart";

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

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: recent, isLoading: recentLoading } = usePages({ limit: 10, sort: "updated_at" });

  if (statsLoading || recentLoading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-muted">Loading...</div>;
  }

  const embeddingPct = stats && stats.chunks > 0
    ? Math.round((stats.embedded_chunks / stats.chunks) * 100)
    : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-100 mb-6">Dashboard</h1>

      <div className="flex gap-4 mb-6 flex-wrap">
        <StatCard label="Pages" value={stats?.pages ?? 0} color="cyan" subtitle={`${Object.keys(stats?.pages_by_type ?? {}).length} types`} />
        <StatCard label="Chunks" value={stats?.chunks ?? 0} color="purple" subtitle={stats ? `avg ${Math.round(stats.chunks / Math.max(stats.pages, 1))}/page` : ""} />
        <StatCard label="Embedded" value={`${embeddingPct}%`} color="green" subtitle={`${stats?.embedded_chunks ?? 0} / ${stats?.chunks ?? 0}`} progress={embeddingPct} />
        <StatCard label="Links" value={stats?.links ?? 0} color="orange" />
      </div>

      <div className="flex gap-6 flex-wrap lg:flex-nowrap">
        <div className="flex-1 min-w-[300px]">
          <TypeChart data={stats?.pages_by_type ?? {}} />
        </div>
        <div className="w-full lg:w-80 bg-card-bg border border-border rounded-xl p-5">
          <div className="text-xs text-muted uppercase tracking-widest mb-4">Recent Updates</div>
          <div className="space-y-3">
            {recent?.map((page) => (
              <Link key={page.slug} to={`/pages/${encodeURIComponent(page.slug)}`} className="flex items-center gap-3 group">
                <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[page.type] ?? "bg-neon-pink"} shadow-[0_0_6px_currentColor]`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-300 truncate group-hover:text-neon-purple transition-colors">{page.slug}</div>
                  <div className="text-xs text-muted">{timeAgo(page.updated_at)}</div>
                </div>
                <span className="text-[10px] text-neon-purple/60 border border-neon-purple/20 rounded px-1.5 py-0.5">{page.type}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
