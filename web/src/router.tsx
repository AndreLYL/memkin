import { createBrowserRouter, Navigate } from "react-router";
import { Shell } from "./components/layout/shell";
import { Dashboard } from "./pages/dashboard";
import { EntityDetail } from "./pages/EntityDetail";
import { PageDetail } from "./pages/page-detail";
import { PageList } from "./pages/page-list";
import { GraphPage } from "./pages/graph";
import { SearchPage } from "./pages/search";
import { TimelinePage } from "./pages/Timeline";
import { ConfigPage } from "./pages/config/index";
import { SetupWizard } from "./pages/setup/index";
import { FetchPage } from "./pages/fetch/index";

export const router = createBrowserRouter([
  { path: "setup", element: <SetupWizard /> },
  { path: "config", element: <ConfigPage /> },
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "timeline", element: <TimelinePage /> },
      { path: "fetch", element: <FetchPage /> },
      { path: "graph", element: <GraphPage /> },
      { path: "entity/*", element: <EntityDetail /> },
      { path: "entities", element: <Navigate to="/pages" replace /> },
      { path: "pages", element: <PageList /> },
      { path: "pages/*", element: <PageDetail /> },
      { path: "search", element: <SearchPage /> },
    ],
  },
]);
