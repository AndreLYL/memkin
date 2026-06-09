import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";

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

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const configToSave: WizardConfig = {
        ...config,
        sources: {
          "claude-code": { enabled: true },
          ...config.sources,
        },
      };
      const result = await configApi.saveConfig(configToSave);
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
        <div className="text-4xl">✓</div>
        <h2 className="text-xl font-bold text-fg-default">Configuration Saved!</h2>
        <p className="text-fg-muted">Run <code className="rounded bg-bg-subtle px-1">memoark serve</code> to start Memoark.</p>
      </div>
    );
  }

  const llm = config.llm;
  const emb = config.embedding;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Review Configuration</h2>

      <div className="rounded border border-border-default divide-y divide-border-default text-sm">
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

      {errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-700">{e}</p>)}
        </div>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Configuration ✓"}
        </button>
      </div>
    </div>
  );
}
