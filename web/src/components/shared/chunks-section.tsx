import { useState } from "react";
import type { ChunkRow } from "../../api/client";

export function ChunksSection({ chunks }: { chunks: ChunkRow[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const embedded = chunks.filter((c) => c.embedded_at).length;
  const toggle = (idx: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  return (
    <div className="space-y-4">
      <div className="bg-bg-surface rounded-xl p-4">
        <div className="text-[11px] font-semibold text-fg-muted uppercase tracking-widest mb-3">
          {chunks.length} chunks · {embedded} embedded
        </div>
        <div className="flex gap-1.5">
          {chunks.map((chunk) => (
            <div
              key={chunk.chunk_index}
              className={`flex-1 h-1.5 rounded-full ${chunk.embedded_at ? "bg-person/60" : "bg-knowledge/40"}`}
              title={`Chunk ${chunk.chunk_index}: ${chunk.token_count} tokens, ${chunk.embedded_at ? "embedded" : "pending"}`}
            />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {chunks.map((chunk) => (
          <div key={chunk.chunk_index} className="bg-bg-surface rounded-xl">
            <button
              onClick={() => toggle(chunk.chunk_index)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className={`w-2 h-2 rounded-full ${chunk.embedded_at ? "bg-person" : "bg-knowledge"}`} />
              <span className="text-xs text-fg-default font-mono">#{chunk.chunk_index}</span>
              <span className="text-xs text-fg-muted">{chunk.token_count} tokens</span>
              <span className="text-xs text-fg-muted ml-auto">
                {chunk.embedded_at ? new Date(chunk.embedded_at).toLocaleDateString() : "pending"}
              </span>
              <span className="text-fg-muted text-xs">{expanded.has(chunk.chunk_index) ? "▼" : "▶"}</span>
            </button>
            {expanded.has(chunk.chunk_index) && (
              <div className="px-4 pb-4 text-xs text-fg-muted font-mono whitespace-pre-wrap border-t border-border-default pt-3">
                {chunk.chunk_text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
