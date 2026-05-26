import { createBrowserRouter } from "react-router";
import { Shell } from "./components/layout/shell";
import { Dashboard } from "./pages/dashboard";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <h2 className="text-xl text-muted">{title}</h2>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "graph", element: <Placeholder title="Knowledge Graph" /> },
      { path: "pages", element: <Placeholder title="Pages" /> },
      { path: "pages/*", element: <Placeholder title="Page Detail" /> },
      { path: "search", element: <Placeholder title="Search" /> },
    ],
  },
]);
