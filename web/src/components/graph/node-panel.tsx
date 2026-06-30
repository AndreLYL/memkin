import { Link } from "react-router";
import { X, ArrowRight } from "lucide-react";
import { useTags } from "../../hooks/use-tags";
import type { LinkRow } from "../../api/client";

interface NodePanelProps {
  slug: string;
  type: string;
  links: LinkRow[];
  onClose: () => void;
}

const TYPE_DOT_COLORS: Record<string, string> = {
  person: "bg-person",
  project: "bg-project",
  decision: "bg-decision",
  session: "bg-knowledge",
  task: "bg-task",
};

export function NodePanel({ slug, type, links, onClose }: NodePanelProps) {
  const { data: tags } = useTags(slug);
  const outgoing = links.filter((l) => l.from_slug === slug).length;
  const incoming = links.filter((l) => l.to_slug === slug).length;

  return (
    <div className="absolute top-12 right-3 w-56 bg-bg-surface/90 backdrop-blur-xl border border-border-default rounded-xl shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)] p-4 z-10">
      {/* justified border: overlay panel needs separation from graph canvas behind it */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-3 text-fg-muted hover:text-fg-default text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-label="Close panel"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2.5 h-2.5 rounded-full ${TYPE_DOT_COLORS[type] ?? "bg-accent"}`} />
        <div className="text-sm font-semibold font-serif text-fg-default">{slug}</div>
      </div>
      <div className="text-[10px] text-fg-muted uppercase tracking-widest mb-1">Type</div>
      <div className="text-xs text-fg-subtle mb-3">{type}</div>
      <div className="text-[10px] text-fg-muted uppercase tracking-widest mb-1">Connections</div>
      <div className="text-xs text-fg-subtle mb-3">{outgoing} outgoing · {incoming} incoming</div>
      {tags && tags.length > 0 && (
        <>
          <div className="text-[10px] text-fg-muted uppercase tracking-widest mb-1">Tags</div>
          <div className="flex gap-1 flex-wrap mb-3">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] text-accent bg-accent/10 border border-accent/30 rounded px-1.5 py-0.5">{tag}</span>
            ))}
          </div>
        </>
      )}
      <div className="border-t border-border-default pt-3">
        <Link
          to={`/entity/${encodeURIComponent(slug)}`}
          className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded"
        >
          View Page <ArrowRight size={12} strokeWidth={1.75} />
        </Link>
      </div>
    </div>
  );
}
