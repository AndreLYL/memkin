interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, subtitle, color, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-bg-surface border border-border-default rounded-xl p-4 min-w-[140px] ${onClick ? "cursor-pointer hover:border-border-muted" : ""}`}
    >
      <div className="text-2xl font-bold text-fg-default" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-fg-subtle mt-1">{label}</div>
      {subtitle && <div className="text-xs text-fg-muted mt-0.5">{subtitle}</div>}
    </div>
  );
}
