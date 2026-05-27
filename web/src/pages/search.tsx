import { useState } from "react";
import { Link } from "react-router";
import { useSearch } from "../hooks/use-search";
import { parseSnippet } from "../utils/highlight";

const TYPE_COLORS: Record<string, string> = {
  person: "bg-neon-cyan",
  project: "bg-neon-purple",
  decision: "bg-neon-green",
  session: "bg-neon-orange",
};

export function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const { data: results, isLoading } = useSearch(query);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="mb-8">
        <input
          className="w-full bg-card-bg border border-border rounded-xl px-6 py-4 text-lg text-gray-200 placeholder-muted focus:outline-none focus:border-neon-purple/50"
          placeholder="Search your knowledge..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
      </form>

      {isLoading && <div className="text-center text-muted">Searching...</div>}

      {!query && !isLoading && (
        <div className="text-center text-muted py-12">Type a query and press Enter to search</div>
      )}

      {query && results && results.length === 0 && (
        <div className="text-center text-muted py-12">No results found</div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-3">
          {results.map((result, i) => {
            const fragments = parseSnippet(result.snippet);
            return (
              <Link
                key={i}
                to={`/pages/${encodeURIComponent(result.slug)}`}
                className="block bg-card-bg border border-border rounded-xl p-4 hover:border-neon-purple/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[result.type] ?? "bg-neon-pink"} shadow-[0_0_6px_currentColor]`} />
                  <span className="text-sm font-medium text-gray-200">{result.slug}</span>
                  {result.title !== result.slug && <span className="text-xs text-muted">{result.title}</span>}
                  <span className="text-[10px] text-muted ml-auto">{result.score.toFixed(3)}</span>
                </div>
                <div className="text-xs text-gray-400 leading-relaxed">
                  {fragments.map((f, j) =>
                    f.highlighted ? (
                      <mark key={j} className="bg-neon-purple/20 text-neon-purple px-0.5 rounded">{f.text}</mark>
                    ) : (
                      <span key={j}>{f.text}</span>
                    ),
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
