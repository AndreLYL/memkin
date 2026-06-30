import { Link } from "react-router";
import { useTags } from "../../hooks/use-tags";
import type { LinkRow } from "../../api/client";

interface NodePanelProps {
  slug: string;
  type: string;
  links: LinkRow[];
  onClose: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  person: "bg-neon-cyan",
  project: "bg-neon-purple",
  decision: "bg-neon-green",
  session: "bg-neon-orange",
};

export function NodePanel({ slug, type, links, onClose }: NodePanelProps) {
  const { data: tags } = useTags(slug);
  const outgoing = links.filter((l) => l.from_slug === slug).length;
  const incoming = links.filter((l) => l.to_slug === slug).length;

  return (
    <div className="absolute top-12 right-3 w-56 bg-card-bg/90 backdrop-blur-xl border border-border rounded-xl p-4 z-10">
      <button onClick={onClose} className="absolute top-2 right-3 text-muted hover:text-gray-300 text-xs">✕</button>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2.5 h-2.5 rounded-full ${TYPE_COLORS[type] ?? "bg-neon-pink"} shadow-[0_0_8px_currentColor]`} />
        <div className="text-sm font-semibold text-gray-100">{slug}</div>
      </div>
      <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Type</div>
      <div className="text-xs text-gray-300 mb-3">{type}</div>
      <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Connections</div>
      <div className="text-xs text-gray-300 mb-3">{outgoing} outgoing · {incoming} incoming</div>
      {tags && tags.length > 0 && (
        <>
          <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Tags</div>
          <div className="flex gap-1 flex-wrap mb-3">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] text-neon-purple bg-neon-purple/10 border border-neon-purple/30 rounded px-1.5 py-0.5">{tag}</span>
            ))}
          </div>
        </>
      )}
      <div className="border-t border-border pt-3">
        <Link to={`/entity/${encodeURIComponent(slug)}`} className="text-[11px] text-neon-purple hover:underline">
          View Page →
        </Link>
      </div>
    </div>
  );
}
