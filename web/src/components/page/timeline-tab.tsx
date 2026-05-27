import { useState } from "react";
import type { TimelineEntry } from "../../api/client";

interface TimelineTabProps {
  entries: TimelineEntry[];
}

export function TimelineTab({ entries }: TimelineTabProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (entries.length === 0) return <div className="text-muted text-sm py-8 text-center">No timeline entries</div>;

  const sorted = [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-0 bottom-0 w-px bg-border" />
      <div className="space-y-4">
        {sorted.map((entry, i) => (
          <div key={i} className="relative">
            <div className="absolute -left-4 top-2 w-2 h-2 rounded-full bg-neon-purple shadow-[0_0_6px_#7b68ee]" />
            <div className="bg-card-bg border border-border rounded-xl p-4">
              <div className="text-sm font-semibold text-gray-200 mb-1">{entry.date}</div>
              <div className="text-xs text-gray-400 mb-2">{entry.summary}</div>
              {entry.detail && (
                <button onClick={() => toggle(i)} className="text-[10px] text-neon-purple hover:underline">
                  {expanded.has(i) ? "Hide detail" : "Show detail"}
                </button>
              )}
              {expanded.has(i) && entry.detail && (
                <div className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{entry.detail}</div>
              )}
              {entry.source && <div className="text-[10px] text-muted mt-2">Source: {entry.source}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
