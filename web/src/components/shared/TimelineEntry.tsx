import { useState } from "react";

interface TimelineEntryProps {
  date: string;
  summary: string;
  detail?: string | null;
  source?: string | null;
}

export function TimelineEntryCard({ date, summary, detail, source }: TimelineEntryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-2 border-border-muted pl-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-subtle">{date}</span>
        <span className="text-sm text-fg-default">{summary}</span>
        {detail && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-accent hover:underline"
          >
            {expanded ? "collapse" : "expand"}
          </button>
        )}
      </div>
      {expanded && detail && (
        <p className="text-xs text-fg-muted mt-1 pl-2 border-l border-border-default">{detail}</p>
      )}
      {source && (
        <span className="text-[10px] text-fg-subtle mt-0.5 block">{source}</span>
      )}
    </div>
  );
}
