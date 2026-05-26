import { useState } from "react";
import { Link, useParams } from "react-router";
import { usePageBySlug } from "../hooks/use-pages";
import { useTags } from "../hooks/use-tags";
import { useChunks } from "../hooks/use-chunks";
import { ContentTab } from "../components/page/content-tab";
import { ChunksTab } from "../components/page/chunks-tab";

const TABS = ["Content", "Chunks", "Links", "Timeline"] as const;
type Tab = (typeof TABS)[number];

const TAG_COLORS = ["text-neon-cyan", "text-neon-green", "text-neon-orange", "text-neon-purple", "text-neon-pink"];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PageDetail() {
  const params = useParams();
  const slug = decodeURIComponent(params["*"] ?? "");
  const { data: page, isLoading } = usePageBySlug(slug);
  const { data: tags } = useTags(slug);
  const { data: chunks } = useChunks(slug);
  const [activeTab, setActiveTab] = useState<Tab>("Content");

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh] text-muted">Loading...</div>;
  if (!page) return <div className="flex items-center justify-center min-h-[60vh] text-muted">Page not found</div>;

  const frontmatter: Record<string, unknown> = {};
  try {
    const match = page.compiled_truth?.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      match[1].split("\n").forEach((line) => {
        const idx = line.indexOf(":");
        if (idx > 0) frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      });
    }
  } catch {}

  const bodyContent = page.compiled_truth?.replace(/^---\n[\s\S]*?\n---\n*/, "") ?? "";

  const tabCounts: Record<string, string> = {
    Chunks: chunks ? `${chunks.length}` : "",
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="text-[11px] text-muted mb-2">
        <Link to="/pages" className="text-neon-purple hover:underline">Pages</Link>
        <span className="mx-1">›</span>
        <span>{slug}</span>
      </div>

      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-[22px] font-bold text-gray-100">{page.title || slug}</h1>
        <span className="text-[10px] text-neon-purple bg-neon-purple/10 border border-neon-purple/30 rounded px-2 py-0.5">{page.type}</span>
      </div>
      <div className="text-[11px] text-muted mb-5">Updated {timeAgo(page.updated_at)} · Created {new Date(page.created_at).toLocaleDateString()}</div>

      {tags && tags.length > 0 && (
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {tags.map((tag, i) => (
            <span key={tag} className={`text-[10px] ${TAG_COLORS[i % TAG_COLORS.length]} bg-current/10 border border-current/30 rounded px-2 py-0.5`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex border-b border-border mb-5">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? "text-neon-purple border-b-2 border-neon-purple"
                : "text-muted hover:text-gray-300"
            }`}
          >
            {tab}{tabCounts[tab] ? ` (${tabCounts[tab]})` : ""}
          </button>
        ))}
      </div>

      {activeTab === "Content" && <ContentTab compiledTruth={bodyContent} frontmatter={frontmatter} />}
      {activeTab === "Chunks" && chunks && <ChunksTab chunks={chunks} />}
      {activeTab === "Links" && <div className="text-muted">Links tab — next task</div>}
      {activeTab === "Timeline" && <div className="text-muted">Timeline tab — next task</div>}
    </div>
  );
}
