interface StatCardProps {
  label: string;
  value: number | string;
  color: "cyan" | "purple" | "green" | "orange";
  subtitle?: string;
  progress?: number;
}

const COLOR_MAP = {
  cyan: { glow: "glow-text-cyan", text: "text-neon-cyan", bar: "bg-neon-cyan" },
  purple: { glow: "glow-text-purple", text: "text-neon-purple", bar: "bg-neon-purple" },
  green: { glow: "glow-text-green", text: "text-neon-green", bar: "bg-neon-green" },
  orange: { glow: "glow-text-orange", text: "text-neon-orange", bar: "bg-neon-orange" },
};

export function StatCard({ label, value, color, subtitle, progress }: StatCardProps) {
  const c = COLOR_MAP[color];
  return (
    <div className="bg-card-bg border border-border rounded-xl p-5 flex-1 min-w-[160px]">
      <div className="text-xs text-muted uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-3xl font-bold ${c.text} ${c.glow}`}>{value}</div>
      {subtitle && <div className="text-xs text-muted mt-1">{subtitle}</div>}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 bg-border rounded-full overflow-hidden">
          <div className={`h-full ${c.bar} rounded-full transition-all`} style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}
    </div>
  );
}
