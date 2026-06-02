interface FilterBarProps {
  typeOptions: string[];
  selectedType: string;
  onTypeChange: (type: string) => void;
  platformOptions?: string[];
  selectedPlatform?: string;
  onPlatformChange?: (platform: string) => void;
  children?: React.ReactNode;
}

export function FilterBar({
  typeOptions,
  selectedType,
  onTypeChange,
  platformOptions,
  selectedPlatform,
  onPlatformChange,
  children,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-surface border border-border-default rounded-lg flex-wrap">
      <select
        value={selectedType}
        onChange={(e) => onTypeChange(e.target.value)}
        className="bg-bg-overlay border border-border-muted rounded px-2 py-1 text-sm text-fg-default"
      >
        <option value="">All Types</option>
        {typeOptions.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {platformOptions && onPlatformChange && (
        <select
          value={selectedPlatform ?? ""}
          onChange={(e) => onPlatformChange(e.target.value)}
          className="bg-bg-overlay border border-border-muted rounded px-2 py-1 text-sm text-fg-default"
        >
          <option value="">All Sources</option>
          {platformOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      )}

      {children}
    </div>
  );
}
