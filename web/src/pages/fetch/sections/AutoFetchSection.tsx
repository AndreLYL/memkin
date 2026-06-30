import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";

interface Props {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

interface SchedulerSourceRow {
  id: string;
  label: string;
}

const KNOWN_SOURCES: SchedulerSourceRow[] = [
  { id: "feishu", label: "Feishu" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "hermes", label: "Hermes" },
];

export function AutoFetchSection({ config, onSave }: Props) {
  const scheduler = config.scheduler;

  const [enabled, setEnabled] = useState(scheduler?.enabled ?? false);
  const [defaultInterval, setDefaultInterval] = useState(
    String(scheduler?.defaults?.interval_secs ?? 3600),
  );
  const [sourceIntervals, setSourceIntervals] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const { id } of KNOWN_SOURCES) {
      const val = scheduler?.sources?.[id]?.interval_secs;
      out[id] = val !== undefined ? String(val) : "";
    }
    return out;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const sources: Record<string, { interval_secs?: number }> = {};
      for (const { id } of KNOWN_SOURCES) {
        const raw = sourceIntervals[id];
        if (raw !== "") {
          const n = Number(raw);
          if (Number.isFinite(n) && n > 0) sources[id] = { interval_secs: n };
        }
      }
      await onSave({
        scheduler: {
          enabled,
          tick_interval_secs: scheduler?.tick_interval_secs ?? 60,
          defaults: { interval_secs: Number(defaultInterval) || 3600 },
          sources,
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <ToggleSwitch
            id="auto-fetch-enabled"
            label="启用定时抓取"
            checked={enabled}
            onChange={setEnabled}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">默认抓取间隔（秒）</label>
        <input
          type="number"
          min="60"
          value={defaultInterval}
          onChange={(e) => setDefaultInterval(e.target.value)}
          className="w-40 rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-fg-muted">各数据源独立间隔（留空 = 用全局默认值）</p>
        {KNOWN_SOURCES.map(({ id, label }) => (
          <div key={id} className="flex items-center gap-3">
            <span className="w-28 text-sm text-fg-default">{label}</span>
            <input
              type="number"
              min="60"
              placeholder={defaultInterval}
              value={sourceIntervals[id]}
              onChange={(e) =>
                setSourceIntervals((prev) => ({ ...prev, [id]: e.target.value }))
              }
              className="w-32 rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default"
            />
            <span className="text-xs text-fg-muted">秒</span>
          </div>
        ))}
      </div>
    </div>
  );
}
