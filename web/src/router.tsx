import { createBrowserRouter } from "react-router";
import { Shell } from "./components/layout/shell";
import { Dashboard } from "./pages/dashboard";
import { PageList } from "./pages/page-list";
import { PageDetail } from "./pages/page-detail";
import { GraphPage } from "./pages/graph";
import { SearchPage } from "./pages/search";

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "graph", element: <GraphPage /> },
      { path: "pages", element: <PageList /> },
      { path: "pages/*", element: <PageDetail /> },
      { path: "search", element: <SearchPage /> },
    ],
  },
]);
