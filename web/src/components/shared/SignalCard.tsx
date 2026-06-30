import { Link } from "react-router";
import { EntityBadge } from "./EntityBadge";

interface SignalCardProps {
  slug: string;
  type: string;
  title: string;
  snippet?: string;
  date?: string;
  platform?: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SignalCard({ slug, type, title, snippet, date, platform }: SignalCardProps) {
  return (
    <Link
      to={`/entity/${encodeURIComponent(slug)}`}
      className="block p-3 rounded-xl bg-bg-surface hover:bg-bg-overlay shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)] hover:-translate-y-0.5 transition"
    >
      <div className="flex items-center gap-2 mb-1">
        <EntityBadge type={type} clickable={false} />
        <span className="text-sm text-fg-default truncate flex-1">{title || slug}</span>
        {date && <span className="text-xs text-fg-subtle shrink-0">{timeAgo(date)}</span>}
      </div>
      {snippet && (
        <p className="text-xs text-fg-muted line-clamp-2 mt-1">{snippet}</p>
      )}
      {platform && (
        <span className="text-[10px] text-fg-subtle mt-1 inline-block">{platform}</span>
      )}
    </Link>
  );
}
