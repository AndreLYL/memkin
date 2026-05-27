import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ForceGraph3D from "react-force-graph-3d";
import type { Page, LinkRow } from "../../api/client";

const TYPE_COLORS: Record<string, string> = {
  person: "#00d4ff",
  project: "#7b68ee",
  decision: "#00ffa3",
  session: "#f97316",
};
const DEFAULT_COLOR = "#ec4899";

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

function buildGraph(pages: Page[], links: LinkRow[]) {
  const connectionCount: Record<string, number> = {};
  for (const link of links) {
    connectionCount[link.from_slug] = (connectionCount[link.from_slug] ?? 0) + 1;
    connectionCount[link.to_slug] = (connectionCount[link.to_slug] ?? 0) + 1;
  }

  const nodes: GraphNode[] = pages.map((p) => ({
    id: p.slug,
    name: p.title || p.slug,
    type: p.type,
    color: TYPE_COLORS[p.type] ?? DEFAULT_COLOR,
    connections: connectionCount[p.slug] ?? 0,
  }));

  const slugSet = new Set(pages.map((p) => p.slug));
  const graphLinks: GraphLink[] = links
    .filter((l) => slugSet.has(l.from_slug) && slugSet.has(l.to_slug))
    .map((l) => ({ source: l.from_slug, target: l.to_slug, linkType: l.link_type }));

  return { nodes, links: graphLinks };
}

function bfsFilter(nodes: GraphNode[], links: GraphLink[], center: string, maxDepth: number): Set<string> {
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

export function ForceGraphView({ pages, links, mode, selectedNode, depth, onNodeClick, onBackgroundClick }: ForceGraphProps) {
  const fgRef = useRef<any>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);

  const graphData = useMemo(() => buildGraph(pages, links), [pages, links]);

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

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const size = 3 + Math.sqrt(node.connections) * 2;
    const isHighlighted = !hoverNode || hoverNode === node.id ||
      graphData.links.some((l) => {
        const s = typeof l.source === "object" ? (l.source as any).id : l.source;
        const t = typeof l.target === "object" ? (l.target as any).id : l.target;
        return (s === hoverNode && t === node.id) || (t === hoverNode && s === node.id);
      });
    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color;
    ctx.globalAlpha = isHighlighted ? 0.8 : 0.1;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (node.id === selectedNode) {
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = `${isHighlighted ? 3 : 2}px Sans-Serif`;
    ctx.fillStyle = isHighlighted ? "#e2e8f0" : "#4a5568";
    ctx.textAlign = "center";
    ctx.fillText(node.name, node.x, node.y + size + 4);
  }, [hoverNode, selectedNode, graphData.links]);

  const linkColor = useCallback((link: any) => {
    if (!hoverNode) return "rgba(100,100,150,0.2)";
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    return s === hoverNode || t === hoverNode ? "rgba(123,104,238,0.5)" : "rgba(100,100,150,0.05)";
  }, [hoverNode]);

  const commonProps = {
    ref: fgRef,
    graphData: filteredData,
    nodeId: "id",
    backgroundColor: "#030308",
    onNodeClick: (node: any) => onNodeClick(node.id),
    onBackgroundClick,
    onNodeHover: (node: any) => setHoverNode(node?.id ?? null),
    linkColor,
    linkWidth: 0.5,
    nodeLabel: (node: any) => `${node.name} (${node.type})`,
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
