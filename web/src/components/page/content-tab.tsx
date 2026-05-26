import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ContentTabProps {
  compiledTruth: string;
  frontmatter: Record<string, unknown>;
}

export function ContentTab({ compiledTruth, frontmatter }: ContentTabProps) {
  return (
    <div className="space-y-4">
      <div className="bg-card-bg border border-border rounded-xl p-5 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{compiledTruth}</ReactMarkdown>
      </div>

      {Object.keys(frontmatter).length > 0 && (
        <div className="bg-card-bg border border-border rounded-xl p-4">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-3">Frontmatter</div>
          <div className="font-mono text-[11px] text-gray-400 space-y-1">
            {Object.entries(frontmatter).map(([k, v]) => (
              <div key={k}>
                <span className="text-neon-purple">{k}:</span> {String(v)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
