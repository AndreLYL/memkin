import { useState } from "react";
import type { ChunkRow } from "../../api/client";

interface ChunksTabProps {
  chunks: ChunkRow[];
}

export function ChunksTab({ chunks }: ChunksTabProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const embedded = chunks.filter((c) => c.embedded_at).length;

  const toggle = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-card-bg border border-border rounded-xl p-4">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-3">
          {chunks.length} chunks · {embedded} embedded
        </div>
        <div className="flex gap-1.5">
          {chunks.map((chunk) => (
            <div
              key={chunk.chunk_index}
              className={`flex-1 h-1.5 rounded-full ${chunk.embedded_at ? "bg-neon-cyan/60" : "bg-neon-orange/40"}`}
              title={`Chunk ${chunk.chunk_index}: ${chunk.token_count} tokens, ${chunk.embedded_at ? "embedded" : "pending"}`}
            />
          ))}
        </div>
        <div className="flex gap-3 mt-2">
          <div className="flex items-center gap-1"><div className="w-2 h-1 bg-neon-cyan rounded opacity-60" /><span className="text-[9px] text-muted">Embedded</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-1 bg-neon-orange rounded opacity-40" /><span className="text-[9px] text-muted">Pending</span></div>
        </div>
      </div>

      <div className="space-y-2">
        {chunks.map((chunk) => (
          <div key={chunk.chunk_index} className="bg-card-bg border border-border rounded-xl">
            <button onClick={() => toggle(chunk.chunk_index)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
              <span className={`w-2 h-2 rounded-full ${chunk.embedded_at ? "bg-neon-cyan" : "bg-neon-orange"}`} />
              <span className="text-xs text-gray-300 font-mono">#{chunk.chunk_index}</span>
              <span className="text-xs text-muted">{chunk.token_count} tokens</span>
              <span className="text-xs text-muted ml-auto">{chunk.embedded_at ? new Date(chunk.embedded_at).toLocaleDateString() : "pending"}</span>
              <span className="text-muted text-xs">{expanded.has(chunk.chunk_index) ? "▼" : "▶"}</span>
            </button>
            {expanded.has(chunk.chunk_index) && (
              <div className="px-4 pb-4 text-xs text-gray-400 font-mono whitespace-pre-wrap border-t border-border pt-3">
                {chunk.chunk_text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
