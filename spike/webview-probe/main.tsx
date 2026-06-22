import { useRef } from "react";
import { createRoot } from "react-dom/client";
import ForceGraph2D from "react-force-graph-2d";

const data = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
  links: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "d" },
    { source: "d", target: "a" },
  ],
};

function App() {
  const fgRef = useRef<any>(null);
  setTimeout(() => {
    document.title = "RENDER_DONE";
  }, 4000);
  return (
    <div style={{ background: "#102030", width: "100vw", height: "100vh" }}>
      {/* DOM control banner: proves WebKitGTK renders DOM at all */}
      <div
        id="dom-banner"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 10,
          background: "#ff3366",
          color: "#ffffff",
          font: "bold 28px sans-serif",
          padding: "8px 16px",
        }}
      >
        DOM_OK
      </div>
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={1280}
        height={900}
        backgroundColor="#102030"
        nodeColor={() => "#00ff88"}
        nodeRelSize={12}
        linkColor={() => "#ffcc00"}
        linkWidth={4}
        cooldownTicks={60}
        onEngineStop={() => fgRef.current && fgRef.current.zoomToFit(0, 80)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
