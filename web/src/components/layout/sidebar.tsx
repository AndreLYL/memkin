import { NavLink } from "react-router";

const NAV_ITEMS = [
  { to: "/", icon: "📊", label: "Dashboard" },
  { to: "/graph", icon: "🕸️", label: "Graph" },
  { to: "/pages", icon: "📄", label: "Pages" },
  { to: "/search", icon: "🔍", label: "Search" },
];

export function Sidebar() {
  return (
    <nav className="w-14 bg-sidebar-bg border-r border-border flex flex-col items-center gap-5 pt-4 pb-4 min-h-screen">
      <div className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br from-neon-cyan to-neon-purple">
        M
      </div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            `w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-opacity ${
              isActive
                ? "bg-neon-purple/10 border border-neon-purple/30 opacity-100"
                : "opacity-40 hover:opacity-70"
            }`
          }
          title={item.label}
        >
          {item.icon}
        </NavLink>
      ))}
    </nav>
  );
}
