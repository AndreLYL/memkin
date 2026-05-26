import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";

const TYPE_COLORS: Record<string, string> = {
  person: "#00d4ff",
  project: "#7b68ee",
  decision: "#00ffa3",
  session: "#f97316",
};
const DEFAULT_COLOR = "#ec4899";

interface TypeChartProps {
  data: Record<string, number>;
}

export function TypeChart({ data }: TypeChartProps) {
  const chartData = Object.entries(data).map(([type, count]) => ({ type, count }));

  if (chartData.length === 0) {
    return <div className="text-muted text-sm">No pages yet</div>;
  }

  return (
    <div className="bg-card-bg border border-border rounded-xl p-5">
      <div className="text-xs text-muted uppercase tracking-widest mb-4">Page Types</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <XAxis dataKey="type" tick={{ fill: "#4a5568", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#4a5568", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid #1a1a2e", borderRadius: 8, fontSize: 12, color: "#a0aec0" }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.type} fill={TYPE_COLORS[entry.type] ?? DEFAULT_COLOR} fillOpacity={0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
