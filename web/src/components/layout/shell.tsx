import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";
import { useSSE } from "../../hooks/useSSE";

export function Shell() {
  useSSE();
  return (
    <div className="flex min-h-screen bg-bg-canvas text-fg-default">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
