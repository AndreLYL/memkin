import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";
import { useSSE } from "../../hooks/useSSE";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

export function Shell() {
  useSSE();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer.current?.querySelector<HTMLElement>("a,button")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menu.current?.focus();
      }
      if (event.key === "Tab") {
        const nodes = drawer.current?.querySelectorAll<HTMLElement>("a,button");
        if (!nodes?.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="flex min-h-screen bg-bg-canvas text-fg-default">
      <div className="md:hidden fixed top-0 inset-x-0 h-14 z-30 bg-bg-canvas border-b border-border-default flex items-center gap-3 px-4">
        <button
          ref={menu}
          aria-label="打开导航"
          aria-expanded={open}
          aria-controls="main-navigation"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} />
        </button>
        <span className="font-semibold">Memkin</span>
      </div>
      {open && (
        <button
          aria-label="关闭导航"
          className="md:hidden fixed inset-0 z-40 bg-black/35"
          onClick={() => {
            setOpen(false);
            menu.current?.focus();
          }}
        />
      )}
      <aside
        ref={drawer}
        id="main-navigation"
        aria-label="导航菜单"
        className={`${open ? "block" : "hidden"} md:block fixed md:static left-0 top-0 bottom-0 z-50 w-[min(84vw,320px)] md:w-[200px] shrink-0 overflow-y-auto bg-bg-inset`}
      >
        <div className="md:hidden flex justify-end p-3">
          <button
            aria-label="收起导航"
            onClick={() => {
              setOpen(false);
              menu.current?.focus();
            }}
          >
            <X size={20} />
          </button>
        </div>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
