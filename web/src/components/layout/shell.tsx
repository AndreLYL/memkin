import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";

export function Shell() {
  return (
    <div className="flex min-h-screen bg-deep-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
