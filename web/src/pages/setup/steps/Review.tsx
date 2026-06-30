import { useState } from "react";
import { CheckCircle } from "lucide-react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

function maskKey(v: string | undefined) {
  if (!v) return "(not set)";
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}...****`;
}

export function Review({ config, onBack }: StepProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [autoFetch, setAutoFetch] = useState(config.scheduler?.enabled ?? true);

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const finalConfig: WizardConfig = {
        ...config,
        sources: {
          "claude-code": { enabled: true },
          ...config.sources,
        },
        scheduler: {
          ...(config.scheduler ?? {}),
          enabled: autoFetch,
          tick_interval_secs: config.scheduler?.tick_interval_secs ?? 60,
          defaults: config.scheduler?.defaults ?? { interval_secs: 3600 },
          sources: config.scheduler?.sources ?? {},
        },
      };
      const result = await configApi.saveConfig(finalConfig);
      if (!result.ok) {
        setErrors(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message));
        return;
      }
      await configApi.setupComplete();
      setSaved(true);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle size={40} strokeWidth={1.75} className="text-green-600" />
        <h2 className="font-serif text-xl font-bold text-fg-default">Configuration Saved!</h2>
        <p className="text-fg-muted">Run <code className="rounded bg-bg-subtle px-1">memoark serve</code> to start Memoark.</p>
      </div>
    );
  }

  const llm = config.llm;
  const emb = config.embedding;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-serif text-xl font-bold text-fg-default">Review Configuration</h2>

      <div className="rounded-xl bg-bg-surface divide-y divide-border-default text-sm shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)]">
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">LLM Provider</span>
          <span className="text-fg-default">{llm?.provider ?? "—"} / {llm?.model ?? "—"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">LLM API Key</span>
          <span className="text-fg-default font-mono">{maskKey(llm?.api_key)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">Embedding</span>
          <span className="text-fg-default">{emb?.provider ?? "—"} / {emb?.model ?? "—"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">Feishu</span>
          <span className="text-fg-default">{config.sources?.feishu?.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">Database Path</span>
          <span className="text-fg-default font-mono">{config.store?.data_dir || "~/.memoark/data (default)"}</span>
        </div>
      </div>

      <div className="rounded-xl bg-bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)]">
        <ToggleSwitch
          id="enable-autofetch"
          label="启用后台定时抓取(开机后自动运行)"
          description="开启后，Memoark 将按计划自动从各数据源抓取内容。"
          checked={autoFetch}
          onChange={setAutoFetch}
        />
        <p className="text-xs text-fg-muted mt-2">
          桌面 App 将默认开机自启,可在系统托盘随时关闭。
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-700">{e}</p>)}
        </div>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">← Back</button>}
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {saving ? "Saving..." : "Save Configuration ✓"}
        </button>
      </div>
    </div>
  );
}
