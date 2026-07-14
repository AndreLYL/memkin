import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ForceGraph3D from "react-force-graph-3d";
import type { LinkRow, Page } from "../../api/client";

// Entity colors come from the theme tokens in styles/theme.css so the graph
// matches the legend chips and flips automatically with light/dark mode.
const TYPE_TOKENS = [
  "person",
  "project",
  "decision",
  "knowledge",
  "task",
  "session",
  "tool",
  "concept",
  "organization",
] as const;

interface ThemeTokens {
  background: string;
  labelStrong: string;
  labelMuted: string;
  link: string;
  linkDim: string;
  linkHover: string;
  typeColors: Record<string, string>;
  defaultColor: string;
}

function readThemeTokens(): ThemeTokens {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const isDark = document.documentElement.dataset.theme === "dark";
  const typeColors: Record<string, string> = {};
  for (const t of TYPE_TOKENS) {
    typeColors[t] = token(`--color-${t}`, isDark ? "#d2879c" : "#b5677e");
  }
  return {
    background: token("--color-bg-canvas", isDark ? "#1a1714" : "#faf8f5"),
    labelStrong: token("--color-fg-default", isDark ? "#f1ece4" : "#2b2620"),
    labelMuted: token("--color-fg-muted", isDark ? "#a89e92" : "#6f675d"),
    link: isDark ? "rgba(168,158,146,0.25)" : "rgba(111,103,93,0.22)",
    linkDim: isDark ? "rgba(168,158,146,0.06)" : "rgba(111,103,93,0.06)",
    linkHover: isDark ? "rgba(212,117,79,0.6)" : "rgba(194,97,61,0.55)",
    typeColors,
    defaultColor: token("--color-fg-subtle", isDark ? "#6f655b" : "#a59b8e"),
  };
}

// Re-read tokens whenever the data-theme attribute flips (sidebar toggle).
function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(() => readThemeTokens());
  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(readThemeTokens()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
  color: string;
  connections: number;
}

interface GraphLink {
  source: string;
  target: string;
  linkType: string;
}

interface ForceGraphProps {
  pages: Page[];
  links: LinkRow[];
  mode: "2d" | "3d";
  selectedNode: string | null;
  depth: number;
  onNodeClick: (slug: string) => void;
  onBackgroundClick: () => void;
}

function buildGraph(
  pages: Page[],
  links: LinkRow[],
  typeColors: Record<string, string>,
  defaultColor: string,
) {
  const connectionCount: Record<string, number> = {};
  for (const link of links) {
    connectionCount[link.from_slug] = (connectionCount[link.from_slug] ?? 0) + 1;
    connectionCount[link.to_slug] = (connectionCount[link.to_slug] ?? 0) + 1;
  }

  const nodes: GraphNode[] = pages.map((p) => ({
    id: p.slug,
    name: p.title || p.slug,
    type: p.type,
    color: typeColors[p.type] ?? defaultColor,
    connections: connectionCount[p.slug] ?? 0,
  }));

  const slugSet = new Set(pages.map((p) => p.slug));
  const graphLinks: GraphLink[] = links
    .filter((l) => slugSet.has(l.from_slug) && slugSet.has(l.to_slug))
    .map((l) => ({ source: l.from_slug, target: l.to_slug, linkType: l.link_type }));

  return { nodes, links: graphLinks };
}

function bfsFilter(
  nodes: GraphNode[],
  links: GraphLink[],
  center: string,
  maxDepth: number,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    const s = typeof l.source === "object" ? (l.source as any).id : l.source;
    const t = typeof l.target === "object" ? (l.target as any).id : l.target;
    adj.set(s, [...(adj.get(s) ?? []), t]);
    adj.set(t, [...(adj.get(t) ?? []), s]);
  }
  const visited = new Set<string>();
  const queue: [string, number][] = [[center, 0]];
  visited.add(center);
  while (queue.length > 0) {
    const [node, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const neighbor of adj.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, depth + 1]);
      }
    }
  }
  return visited;
}

export function ForceGraphView({
  pages,
  links,
  mode,
  selectedNode,
  depth,
  onNodeClick,
  onBackgroundClick,
}: ForceGraphProps) {
  const fgRef = useRef<any>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const theme = useThemeTokens();

  const graphData = useMemo(
    () => buildGraph(pages, links, theme.typeColors, theme.defaultColor),
    [pages, links, theme],
  );

  // Precomputed neighbor sets: O(1) hover-highlight lookup instead of scanning every
  // link for every node on every frame (was O(nodes × links) ≈ millions/frame).
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of graphData.links) {
      const s = typeof l.source === "object" ? (l.source as any).id : l.source;
      const t = typeof l.target === "object" ? (l.target as any).id : l.target;
      (map.get(s) ?? map.set(s, new Set()).get(s)!).add(t);
      (map.get(t) ?? map.set(t, new Set()).get(t)!).add(s);
    }
    return map;
  }, [graphData]);

  const visibleNodes = useMemo(() => {
    if (!selectedNode) return null;
    return bfsFilter(graphData.nodes, graphData.links, selectedNode, depth);
  }, [graphData, selectedNode, depth]);

  const filteredData = useMemo(() => {
    if (!visibleNodes) return graphData;
    const nodes = graphData.nodes.filter((n) => visibleNodes.has(n.id));
    const nodeSet = new Set(nodes.map((n) => n.id));
    const filteredLinks = graphData.links.filter((l) => {
      const s = typeof l.source === "object" ? (l.source as any).id : l.source;
      const t = typeof l.target === "object" ? (l.target as any).id : l.target;
      return nodeSet.has(s) && nodeSet.has(t);
    });
    return { nodes, links: filteredLinks };
  }, [graphData, visibleNodes]);

  // Fit the layout into view once the simulation settles, and again whenever the
  // visible node set changes (mode / filter / focus switches).
  const didFitRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filteredData/mode are intentional reset triggers, not read in the body
  useEffect(() => {
    didFitRef.current = false;
  }, [filteredData, mode]);
  const filteredDataRef = useRef(filteredData);
  filteredDataRef.current = filteredData;
  const handleEngineStop = useCallback(() => {
    if (didFitRef.current) return;
    // The engine also "stops" on the initial empty render — don't consume the
    // one-shot fit before real data has arrived.
    if (filteredDataRef.current.nodes.length === 0) return;
    didFitRef.current = true;
    fgRef.current?.zoomToFit?.(400, 60);
    // zoomToFit zooms IN aggressively on small graphs (nodes fill the screen);
    // cap the settled zoom so the default view stays readable.
    setTimeout(() => {
      const zoom = fgRef.current?.zoom?.();
      if (typeof zoom === "number" && zoom > 1.6) fgRef.current.zoom(1.6, 200);
    }, 450);
  }, []);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = 3 + Math.sqrt(node.connections) * 2;
      // O(1) neighbor lookup (see `adjacency`). Short-circuits when nothing is hovered.
      const isHighlighted =
        !hoverNode || hoverNode === node.id || (adjacency.get(hoverNode)?.has(node.id) ?? false);
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = isHighlighted ? 0.85 : 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (node.id === selectedNode) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Label culling: drawing 3000+ fillText every frame is the other hot path and
      // visually clutters. Only label hubs (large nodes), the hovered neighborhood, or
      // when zoomed in enough to read them.
      const showLabel = size > 8 || globalScale > 1.4 || (!!hoverNode && isHighlighted);
      if (showLabel) {
        ctx.font = `${isHighlighted ? 3 : 2}px Sans-Serif`;
        ctx.fillStyle = isHighlighted ? theme.labelStrong : theme.labelMuted;
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y + size + 4);
      }
    },
    [hoverNode, selectedNode, adjacency, theme],
  );

  const linkColor = useCallback(
    (link: any) => {
      if (!hoverNode) return theme.link;
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      return s === hoverNode || t === hoverNode ? theme.linkHover : theme.linkDim;
    },
    [hoverNode, theme],
  );

  const commonProps = {
    ref: fgRef,
    graphData: filteredData,
    nodeId: "id",
    backgroundColor: theme.background,
    onNodeClick: (node: any) => onNodeClick(node.id),
    onBackgroundClick,
    onNodeHover: (node: any) => setHoverNode(node?.id ?? null),
    onEngineStop: handleEngineStop,
    linkColor,
    linkWidth: 0.5,
    nodeLabel: (node: any) => `${node.name} (${node.type})`,
    // Stop the force simulation sooner (default 15s) so it stops re-rendering every
    // frame once the layout is good enough.
    cooldownTime: 8000,
  };

  if (mode === "2d") {
    return <ForceGraph2D {...commonProps} nodeCanvasObject={nodeCanvasObject} />;
  }

  return (
    <ForceGraph3D
      {...commonProps}
      nodeColor={(node: any) => node.color}
      nodeVal={(node: any) => 1 + Math.sqrt(node.connections)}
      nodeOpacity={0.8}
    />
  );
}
