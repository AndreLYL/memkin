import { useState, useMemo } from "react";
import { useAllPages, useAllLinks } from "../hooks/use-graph";
import { ForceGraphView } from "../components/graph/force-graph";
import { NodePanel } from "../components/graph/node-panel";

export function GraphPage() {
  const { data: pages, isLoading: pagesLoading } = useAllPages();
  const { data: links, isLoading: linksLoading } = useAllLinks();
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);
  const [search, setSearch] = useState("");

  const selectedPage = useMemo(
    () => pages?.find((p) => p.slug === selectedNode),
    [pages, selectedNode],
  );

  if (pagesLoading || linksLoading) {
    return <div className="flex items-center justify-center min-h-[60vh] text-muted">Loading graph...</div>;
  }

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: "#030308" }}>
      {/* Top Controls */}
      <div className="absolute top-3 left-3 right-3 flex justify-between items-center z-10">
        <div className="flex gap-2 items-center">
          <input
            className="bg-card-bg/70 backdrop-blur border border-border rounded-lg px-3 py-1.5 text-[11px] text-gray-200 placeholder-muted w-48 focus:outline-none focus:border-neon-purple/50"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="bg-card-bg/70 backdrop-blur border border-border rounded-md px-2.5 py-1.5 text-[10px] text-gray-300">
            Depth: <input type="range" min={1} max={5} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="w-16 align-middle" /> {depth}
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setMode("2d")}
            className={`px-2.5 py-1 rounded-md text-[10px] backdrop-blur border ${mode === "2d" ? "bg-neon-purple/20 border-neon-purple/50 text-neon-purple font-semibold" : "bg-card-bg/70 border-border text-gray-400"}`}
          >2D</button>
          <button
            onClick={() => setMode("3d")}
            className={`px-2.5 py-1 rounded-md text-[10px] backdrop-blur border ${mode === "3d" ? "bg-neon-purple/20 border-neon-purple/50 text-neon-purple font-semibold" : "bg-card-bg/70 border-border text-gray-400"}`}
          >3D</button>
        </div>
      </div>

      {/* Graph */}
      <ForceGraphView
        pages={pages ?? []}
        links={links ?? []}
        mode={mode}
        selectedNode={selectedNode}
        depth={depth}
        onNodeClick={(slug) => setSelectedNode(slug)}
        onBackgroundClick={() => setSelectedNode(null)}
      />

      {/* Node Detail Panel */}
      {selectedNode && selectedPage && (
        <NodePanel
          slug={selectedNode}
          type={selectedPage.type}
          links={links ?? []}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-card-bg/70 backdrop-blur border border-border rounded-lg px-3 py-2 z-10">
        <div className="flex gap-3 items-center">
          {[
            { color: "bg-neon-cyan", label: "person" },
            { color: "bg-neon-purple", label: "project" },
            { color: "bg-neon-green", label: "decision" },
            { color: "bg-neon-orange", label: "session" },
            { color: "bg-neon-pink", label: "other" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${color} shadow-[0_0_4px_currentColor]`} />
              <span className="text-[9px] text-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
