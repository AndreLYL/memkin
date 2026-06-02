import { createBrowserRouter, Navigate } from "react-router";
import { Shell } from "./components/layout/shell";
import { Dashboard } from "./pages/dashboard";
import { PageList } from "./pages/page-list";
import { PageDetail } from "./pages/page-detail";
import { GraphPage } from "./pages/graph";
import { SearchPage } from "./pages/search";
import { TimelinePage } from "./pages/Timeline";
import { EntityDetail } from "./pages/EntityDetail";

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "timeline", element: <TimelinePage /> },
      { path: "graph", element: <GraphPage /> },
      { path: "entity/*", element: <EntityDetail /> },
      { path: "entities", element: <Navigate to="/pages" replace /> },
      { path: "pages", element: <PageList /> },
      { path: "pages/*", element: <PageDetail /> },
      { path: "search", element: <SearchPage /> },
    ],
  },
]);
