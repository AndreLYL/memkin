import { Link, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { StatCard } from "../components/shared/StatCard";
import { SignalCard } from "../components/shared/SignalCard";
import { EntityBadge } from "../components/shared/EntityBadge";
import { EmptyState } from "../components/shared/EmptyState";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30000 });
  const { data: recent, isLoading: recentLoading } = useQuery({
    queryKey: ["pages", { sort: "updated_at", limit: 10 }],
    queryFn: () => api.pages({ sort: "updated_at", order: "desc", limit: 10 }),
  });
  const { data: topEntities } = useQuery({
    queryKey: ["pages", { sort: "backlinks", limit: 8 }],
    queryFn: () => api.pages({ sort: "backlinks", order: "desc", limit: 8 }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.extract(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["pages"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });

  if (statsLoading || recentLoading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-fg-muted">Loading...</div>;
  }

  const activeSources = health?.sources.filter((s) => s.status === "healthy").length ?? 0;
  const lastSync = health?.daemon.last_run;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-fg-default">Dashboard</h1>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="px-3 py-1.5 bg-accent-muted text-fg-default rounded-lg text-sm hover:bg-accent transition-colors disabled:opacity-50"
        >
          {syncMutation.isPending ? "Syncing..." : "↻ Sync Now"}
        </button>
      </div>
      <p className="text-xs text-fg-subtle mb-6">
        {lastSync ? `Last sync: ${timeAgo(lastSync)}` : "Never synced"} · {activeSources} source{activeSources !== 1 ? "s" : ""} active
      </p>

      <div className="flex gap-4 mb-6 flex-wrap">
        <StatCard label="Total" value={stats?.pages ?? 0} subtitle={`${Object.keys(stats?.pages_by_type ?? {}).length} types`} />
        <StatCard
          label="People"
          value={stats?.pages_by_type?.person ?? 0}
          color="var(--color-person)"
          onClick={() => navigate("/search?type=person")}
        />
        <StatCard label="Links" value={stats?.links ?? 0} color="var(--color-project)" />
        <StatCard
          label="Sources"
          value={activeSources}
          color="var(--color-decision)"
          subtitle={health?.daemon.running ? "● running" : "○ idle"}
        />
      </div>

      <div className="flex gap-6 flex-wrap lg:flex-nowrap">
        <div className="flex-1 min-w-[300px]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-widest text-fg-subtle">Recent Activity</h2>
            <Link to="/timeline" className="text-xs text-accent hover:underline">View all →</Link>
          </div>
          <div className="space-y-2">
            {recent && recent.length > 0 ? (
              recent.map((page) => (
                <SignalCard
                  key={page.slug}
                  slug={page.slug}
                  type={page.type}
                  title={page.title || page.slug}
                  snippet={page.compiled_truth?.slice(0, 120)}
                  date={page.updated_at}
                />
              ))
            ) : (
              <EmptyState title="No activity yet" description="Run a sync to start extracting signals" />
            )}
          </div>
        </div>

        <div className="w-full lg:w-80">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-widest text-fg-subtle">Top Entities</h2>
            <Link to="/entities" className="text-xs text-accent hover:underline">View all →</Link>
          </div>
          <div className="bg-bg-surface border border-border-default rounded-xl p-4 space-y-3">
            {topEntities?.map((page) => (
              <Link
                key={page.slug}
                to={`/entity/${encodeURIComponent(page.slug)}`}
                className="flex items-center gap-3 group"
              >
                <EntityBadge type={page.type} clickable={false} />
                <span className="flex-1 text-sm text-fg-default truncate group-hover:text-accent transition-colors">
                  {page.title || page.slug}
                </span>
              </Link>
            ))}
            {(!topEntities || topEntities.length === 0) && (
              <p className="text-xs text-fg-subtle">No entities yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
