const PLATFORM_LABELS: Record<string, string> = {
  feishu: "Feishu",
  "claude-code": "Claude Code",
  codex: "Codex",
  manual: "Manual",
};

interface SourceBadgeProps {
  platform: string;
}

export function SourceBadge({ platform }: SourceBadgeProps) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-bg-overlay text-fg-subtle border border-border-default">
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  );
}
