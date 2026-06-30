import { Link } from "react-router";
import type { LinkRow } from "../../api/client";

function LinkList({ links, direction }: { links: LinkRow[]; direction: "outgoing" | "incoming" }) {
  if (links.length === 0)
    return <div className="text-fg-muted text-sm py-4">No {direction} links</div>;
  return (
    <div className="space-y-2">
      {links.map((link, i) => {
        const targetSlug = direction === "outgoing" ? link.to_slug : link.from_slug;
        return (
          <Link
            key={i}
            to={`/entity/${encodeURIComponent(targetSlug)}`}
            className="flex items-center gap-3 px-4 py-3 bg-bg-surface rounded-lg hover:bg-bg-overlay transition-colors"
          >
            <span className="text-sm text-fg-default">{targetSlug}</span>
            <span className="text-[10px] text-decision bg-decision/10 border border-decision/30 rounded px-1.5 py-0.5">
              {link.link_type}
            </span>
            {link.context && <span className="text-xs text-fg-muted ml-auto">{link.context}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export function LinksSection({ outgoing, incoming }: { outgoing: LinkRow[]; incoming: LinkRow[] }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold text-fg-muted uppercase tracking-widest mb-3">
          Outgoing Links ({outgoing.length})
        </div>
        <LinkList links={outgoing} direction="outgoing" />
      </div>
      <div>
        <div className="text-xs font-semibold text-fg-muted uppercase tracking-widest mb-3">
          Incoming Links ({incoming.length})
        </div>
        <LinkList links={incoming} direction="incoming" />
      </div>
    </div>
  );
}
