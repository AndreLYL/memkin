import { useParams, useNavigate, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { SignalCard } from "../components/shared/SignalCard";
import { EmptyState } from "../components/shared/EmptyState";
import { EntityBadge } from "../components/shared/EntityBadge";
import { useState } from "react";

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  project: "Project",
  tool: "Tool",
  concept: "Concept",
  organization: "Organization",
  decision: "Decision",
  task: "Task",
  knowledge: "Knowledge",
  "discovery-procedure": "Procedure",
  "discovery-preference": "Preference",
  "discovery-pattern": "Pattern",
  "discovery-insight": "Insight",
  "discovery-risk": "Risk",
};

type Section =
  | "overview"
  | "timeline"
  | "graph"
  | "decisions"
  | "tasks"
  | "knowledge";

function getSections(type: string): Section[] {
  switch (type) {
    case "project":
      return ["overview", "tasks", "timeline", "graph", "decisions", "knowledge"];
    case "tool":
      return ["overview", "knowledge", "timeline", "graph", "decisions", "tasks"];
    case "concept":
      return ["overview", "decisions", "knowledge", "timeline", "graph", "tasks"];
    default:
      return ["overview", "timeline", "graph", "decisions", "tasks", "knowledge"];
  }
}

export function EntityDetail() {
  const params = useParams();
  const slug = params["*"] ?? "";
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>("overview");

  const {
    data: entity,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["entity", slug],
    queryFn: () => api.pageBySlug(slug, "links,backlinks,timeline"),
    enabled: slug.length > 0,
  });

  const { data: graphData } = useQuery({
    queryKey: ["entity-graph", slug],
    queryFn: () => api.traverse(slug, 1, "both"),
    enabled: slug.length > 0 && activeSection === "graph",
  });

  if (isLoading)
    return (
      <div className="text-fg-muted text-center py-16">Loading...</div>
    );
  if (error || !entity)
    return (
      <div className="p-6">
        <EmptyState
          title="Entity not found"
          description={`No entity with slug "${slug}"`}
        />
      </div>
    );

  const type = entity.type ?? "unknown";
  const sections = getSections(type);
  const links = (entity as any).links ?? [];
  const backlinks = (entity as any).backlinks ?? [];
  const timelineEntries = (entity as any).timeline ?? [];
  const mentionCount = backlinks.length;

  const relatedByType = (targetType: string) =>
    links
      .filter((l: any) => l.to_type === targetType)
      .map((l: any) => ({
        slug: l.to_slug ?? l.to,
        title: l.to_title ?? l.to,
        type: l.to_type,
      }));

  const backlinksByType = (targetType: string) =>
    backlinks
      .filter((b: any) => b.from_type === targetType)
      .map((b: any) => ({
        slug: b.from_slug ?? b.from,
        title: b.from_title ?? b.from,
        type: b.from_type,
      }));

  const relatedDecisions = [
    ...relatedByType("decision"),
    ...backlinksByType("decision"),
  ];
  const relatedTasks = [...relatedByType("task"), ...backlinksByType("task")];
  const relatedKnowledge = [
    ...relatedByType("knowledge"),
    ...backlinksByType("knowledge"),
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-fg-subtle hover:text-fg-default mb-3 inline-flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="flex items-start gap-3">
          <div>
            <h1 className="text-2xl font-bold text-fg-default">
              {entity.title ?? slug}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-fg-subtle">
              <EntityBadge type={type} clickable={false} />
              <span>
                {mentionCount} mention{mentionCount !== 1 ? "s" : ""}
              </span>
              <span>
                First seen: {new Date(entity.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6">
        <nav className="w-40 shrink-0 space-y-1">
          {sections.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                activeSection === s
                  ? "bg-bg-overlay text-fg-default font-medium"
                  : "text-fg-subtle hover:text-fg-default hover:bg-bg-surface"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {activeSection === "overview" && (
            <div className="space-y-4">
              {entity.compiled_truth ? (
                <div className="text-sm text-fg-default whitespace-pre-wrap leading-relaxed">
                  {entity.compiled_truth}
                </div>
              ) : (
                <p className="text-fg-subtle text-sm">
                  No compiled summary available.
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-bg-surface border border-border-default rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-fg-default">
                    {mentionCount}
                  </div>
                  <div className="text-xs text-fg-subtle">Mentions</div>
                </div>
                <div className="bg-bg-surface border border-border-default rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-fg-default">
                    {links.length}
                  </div>
                  <div className="text-xs text-fg-subtle">Links</div>
                </div>
                <div className="bg-bg-surface border border-border-default rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-fg-default">
                    {timelineEntries.length}
                  </div>
                  <div className="text-xs text-fg-subtle">Timeline</div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "timeline" && (
            <div className="space-y-3">
              {timelineEntries.length === 0 ? (
                <EmptyState
                  title="No timeline"
                  description="No timeline entries for this entity"
                />
              ) : (
                timelineEntries.map((entry: any, i: number) => (
                  <div
                    key={i}
                    className="border border-border-default rounded-lg p-3 bg-bg-surface"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-fg-subtle">
                        {new Date(entry.date).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-fg-default">{entry.summary}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeSection === "graph" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg-subtle">
                  Connections (depth 1)
                </span>
                <Link
                  to={`/graph?focus=${encodeURIComponent(slug)}`}
                  className="text-xs text-accent hover:underline"
                >
                  Open in Graph →
                </Link>
              </div>
              {graphData ? (
                <div className="border border-border-default rounded-lg p-4 bg-bg-surface">
                  <div className="text-sm text-fg-default mb-2">
                    {(graphData.nodes as any[])?.length ?? 0} connected nodes,{" "}
                    {(graphData.edges as any[])?.length ?? 0} edges
                  </div>
                  <div className="space-y-1">
                    {((graphData.nodes as any[]) ?? [])
                      .filter((n: any) => n.slug !== slug)
                      .map((n: any) => (
                        <Link
                          key={n.slug}
                          to={`/entity/${n.slug}`}
                          className="block text-sm text-accent hover:underline"
                        >
                          {n.title ?? n.slug}
                          <span className="ml-2 text-xs text-fg-subtle">
                            {TYPE_LABELS[n.type] ?? n.type}
                          </span>
                        </Link>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="text-fg-muted text-center py-4">
                  Loading graph...
                </div>
              )}
            </div>
          )}

          {activeSection === "decisions" && (
            <div className="space-y-2">
              {relatedDecisions.length === 0 ? (
                <EmptyState
                  title="No decisions"
                  description="No decisions linked to this entity"
                />
              ) : (
                relatedDecisions.map((d: any) => (
                  <SignalCard
                    key={d.slug}
                    slug={d.slug}
                    type="decision"
                    title={d.title ?? d.slug}
                  />
                ))
              )}
            </div>
          )}

          {activeSection === "tasks" && (
            <div className="space-y-2">
              {relatedTasks.length === 0 ? (
                <EmptyState
                  title="No tasks"
                  description="No tasks linked to this entity"
                />
              ) : (
                relatedTasks.map((t: any) => (
                  <SignalCard
                    key={t.slug}
                    slug={t.slug}
                    type="task"
                    title={t.title ?? t.slug}
                  />
                ))
              )}
            </div>
          )}

          {activeSection === "knowledge" && (
            <div className="space-y-2">
              {relatedKnowledge.length === 0 ? (
                <EmptyState
                  title="No knowledge"
                  description="No knowledge entries linked to this entity"
                />
              ) : (
                relatedKnowledge.map((k: any) => (
                  <SignalCard
                    key={k.slug}
                    slug={k.slug}
                    type="knowledge"
                    title={k.title ?? k.slug}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
