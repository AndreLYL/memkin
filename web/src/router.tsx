import { createBrowserRouter } from "react-router";
import { Shell } from "./components/layout/shell";
import { Dashboard } from "./pages/dashboard";
import { PageList } from "./pages/page-list";
import { PageDetail } from "./pages/page-detail";

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
      { path: "pages", element: <PageList /> },
      { path: "pages/*", element: <PageDetail /> },
      { path: "search", element: <Placeholder title="Search" /> },
    ],
  },
]);
