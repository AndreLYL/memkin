import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { useAllPages, useAllLinks, useTraverse } from "../hooks/use-graph";
import { ForceGraphView } from "../components/graph/force-graph";
import type { Page, LinkRow } from "../api/client";

const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  person: { color: "#58a6ff", label: "Person" },
  project: { color: "#3fb950", label: "Project" },
  decision: { color: "#79c0ff", label: "Decision" },
  task: { color: "#f778ba", label: "Task" },
  knowledge: { color: "#56d4dd", label: "Knowledge" },
  tool: { color: "#d2a8ff", label: "Tool" },
  concept: { color: "#e3b341", label: "Concept" },
  organization: { color: "#f0883e", label: "Organization" },
};

type GraphMode = "global" | "focus";

interface TraverseNode {
  slug: string;
  title?: string;
  type: string;
  backlinks?: number;
}

interface TraverseEdge {
  from_slug: string;
  to_slug: string;
  link_type: string;
}

export function GraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const focusSlug = searchParams.get("focus");
  const [mode, setMode] = useState<GraphMode>(focusSlug ? "focus" : "global");
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [depth, setDepth] = useState(1);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [minConnections, setMinConnections] = useState(0);
  const [focusInput, setFocusInput] = useState(focusSlug ?? "");

  const { data: pages, isLoading: pagesLoading } = useAllPages();
  const { data: links, isLoading: linksLoading } = useAllLinks();
  const { data: traverseData, isLoading: traverseLoading } = useTraverse(
    mode === "focus" ? focusSlug : null,
    depth,
  );

  const isLoading = mode === "global" ? pagesLoading || linksLoading : traverseLoading;

  const graphPages = useMemo(() => {
    if (mode === "global") {
      if (!pages) return [];
      const backlinkCounts = new Map<string, number>();
      for (const l of links ?? []) {
        backlinkCounts.set(l.to_slug, (backlinkCounts.get(l.to_slug) ?? 0) + 1);
      }
      return pages
        .filter((p) => typeFilter.size === 0 || typeFilter.has(p.type))
        .filter((p) => (backlinkCounts.get(p.slug) ?? 0) >= minConnections);
    }
    if (!traverseData) return [];
    const focus = traverseData.focus as TraverseNode | null;
    const nodes = (traverseData.nodes as TraverseNode[]) ?? [];
    const all: Page[] = [
      ...(focus ? [{
        slug: focus.slug,
        title: focus.title ?? focus.slug,
        type: focus.type,
        compiled_truth: "",
        created_at: "",
        updated_at: "",
      } as Page] : []),
      ...nodes.map((n) => ({
        slug: n.slug,
        title: n.title ?? n.slug,
        type: n.type,
        compiled_truth: "",
        created_at: "",
        updated_at: "",
      } as Page)),
    ];
    return all.filter((n) => typeFilter.size === 0 || typeFilter.has(n.type));
  }, [mode, pages, links, traverseData, typeFilter, minConnections]);

  const graphLinks = useMemo(() => {
    if (mode === "global") {
      if (!links) return [];
      const validSlugs = new Set(graphPages.map((n) => n.slug));
      return links.filter((l) => validSlugs.has(l.from_slug) && validSlugs.has(l.to_slug));
    }
    const edges = (traverseData?.edges as TraverseEdge[]) ?? [];
    return edges.map((e) => ({
      from_slug: e.from_slug,
      to_slug: e.to_slug,
      link_type: e.link_type,
      context: "",
    } as LinkRow));
  }, [mode, links, traverseData, graphPages]);

  const handleNodeClick = useCallback(
    (slug: string) => {
      if (mode === "focus") {
        navigate(`/entity/${slug}`);
      } else {
        setSearchParams({ focus: slug });
        setMode("focus");
        setFocusInput(slug);
      }
    },
    [mode, navigate, setSearchParams],
  );

  const switchToGlobal = () => {
    setMode("global");
    setSearchParams({});
    setFocusInput("");
  };

  const switchToFocus = (slug?: string) => {
    const target = slug ?? focusInput;
    if (!target) return;
    setMode("focus");
    setSearchParams({ focus: target });
  };

  const toggleTypeFilter = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  if (isLoading) return <div className="text-fg-muted text-center py-16">Loading graph...</div>;

  return (
    <div className="relative w-full h-[calc(100vh-3rem)] overflow-hidden bg-bg-canvas rounded-lg border border-border-default">
      {/* Top bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10 gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold font-serif text-fg-default">Knowledge Graph</h2>
          <div className="flex gap-1 bg-bg-surface border border-border-default rounded-md p-0.5">
            <button
              onClick={switchToGlobal}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                mode === "global" ? "bg-bg-overlay text-fg-default font-medium" : "text-fg-subtle hover:text-fg-default"
              }`}
            >Global</button>
            <button
              onClick={() => switchToFocus()}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                mode === "focus" ? "bg-bg-overlay text-fg-default font-medium" : "text-fg-subtle hover:text-fg-default"
              }`}
            >Focus</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === "focus" && (
            <>
              <input
                className="bg-bg-surface border border-border-default rounded px-2 py-1 text-xs text-fg-default placeholder:text-fg-subtle w-40"
                placeholder="Entity slug..."
                value={focusInput}
                onChange={(e) => setFocusInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && switchToFocus()}
              />
              <div className="flex items-center gap-1 text-xs text-fg-subtle">
                Depth:
                <select
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  className="bg-bg-surface border border-border-default rounded px-1 py-0.5 text-xs text-fg-default"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
            </>
          )}
          {mode === "global" && (
            <div className="flex items-center gap-1 text-xs text-fg-subtle">
              Min connections:
              <select
                value={minConnections}
                onChange={(e) => setMinConnections(Number(e.target.value))}
                className="bg-bg-surface border border-border-default rounded px-1 py-0.5 text-xs text-fg-default"
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3+</option>
              </select>
            </div>
          )}
          <div className="flex gap-1 bg-bg-surface border border-border-default rounded-md p-0.5">
            <button onClick={() => setViewMode("2d")} className={`px-2 py-0.5 rounded text-xs ${viewMode === "2d" ? "bg-bg-overlay text-fg-default" : "text-fg-subtle"}`}>2D</button>
            <button onClick={() => setViewMode("3d")} className={`px-2 py-0.5 rounded text-xs ${viewMode === "3d" ? "bg-bg-overlay text-fg-default" : "text-fg-subtle"}`}>3D</button>
          </div>
        </div>
      </div>

      {/* Type filter chips */}
      <div className="absolute top-12 left-3 z-10 flex flex-wrap gap-1">
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => (
          <button
            key={type}
            onClick={() => toggleTypeFilter(type)}
            className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
              typeFilter.size === 0 || typeFilter.has(type)
                ? "border-border-default bg-bg-surface text-fg-default"
                : "border-transparent bg-bg-surface/50 text-fg-subtle opacity-50"
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: cfg.color }} />
            {cfg.label}
          </button>
        ))}
      </div>

      {/* Graph canvas */}
      <ForceGraphView
        pages={graphPages}
        links={graphLinks}
        mode={viewMode}
        selectedNode={mode === "focus" ? focusSlug : null}
        depth={depth}
        onNodeClick={handleNodeClick}
        onBackgroundClick={() => {}}
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-bg-surface/80 backdrop-blur border border-border-default rounded-lg px-3 py-2 z-10">
        <div className="text-[10px] text-fg-subtle mb-1">Legend</div>
        <div className="flex gap-3 items-center flex-wrap">
          {Object.entries(TYPE_CONFIG).map(([, cfg]) => (
            <div key={cfg.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
              <span className="text-[9px] text-fg-subtle">{cfg.label}</span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-fg-subtle mt-1">Node size = backlink count</div>
      </div>

      {/* Stats */}
      <div className="absolute bottom-3 right-3 bg-bg-surface/80 backdrop-blur border border-border-default rounded-lg px-3 py-1.5 z-10 text-[10px] text-fg-subtle">
        {graphPages.length} nodes · {graphLinks.length} edges
      </div>
    </div>
  );
}
