interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, subtitle, color, onClick }: StatCardProps) {
  const baseClass =
    "bg-bg-surface rounded-xl p-4 min-w-[140px] shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)] hover:-translate-y-0.5 transition text-left";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
      >
        <div className="text-2xl font-bold font-serif text-fg-default" style={color ? { color } : undefined}>
          {value}
        </div>
        <div className="text-xs uppercase tracking-wide text-fg-subtle mt-1">{label}</div>
        {subtitle && <div className="text-xs text-fg-muted mt-0.5">{subtitle}</div>}
      </button>
    );
  }

  return (
    <div className={baseClass}>
      <div className="text-2xl font-bold font-serif text-fg-default" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-xs uppercase tracking-wide text-fg-subtle mt-1">{label}</div>
      {subtitle && <div className="text-xs text-fg-muted mt-0.5">{subtitle}</div>}
    </div>
  );
}
