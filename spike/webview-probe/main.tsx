import { createRoot } from "react-dom/client";
import ForceGraph2D from "react-force-graph-2d";
const data = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
  links: [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "d" }, { source: "d", target: "a" }],
};
function App() {
  setTimeout(() => { document.title = "RENDER_DONE"; }, 4000);
  return <ForceGraph2D graphData={data} width={1200} height={800} />;
}
createRoot(document.getElementById("root")!).render(<App />);
