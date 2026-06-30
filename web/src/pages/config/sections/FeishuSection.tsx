import { useState } from "react";
import type { WizardConfig, WizardFeishuSources } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ConnectionTest } from "../../../components/config/ConnectionTest";
import { SecretInput } from "../../../components/config/SecretInput";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

const SOURCES: { key: keyof WizardFeishuSources; label: string }[] = [
  { key: "dm", label: "Direct Messages" },
  { key: "messages", label: "Group Messages" },
  { key: "mail", label: "Email" },
  { key: "docs", label: "Docs" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
];

export function FeishuSection({ config, onSave }: SectionProps) {
  const [feishu, setFeishu] = useState(config.sources?.feishu ?? {});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave({ sources: { ...config.sources, feishu } }); } finally { setSaving(false); }
  };

  const sources = feishu.sources ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">Feishu</h3>
        <button type="button" onClick={save} disabled={saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <ToggleSwitch id="cfg-feishu-enabled" label="Feishu enabled" checked={feishu.enabled ?? false}
        onChange={(v) => setFeishu({ ...feishu, enabled: v })} />
      {feishu.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-muted">App ID</label>
              <input type="text" value={feishu.app_id ?? ""} onChange={(e) => setFeishu({ ...feishu, app_id: e.target.value })}
                className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
            </div>
            <SecretInput id="cfg-feishu-secret" label="App Secret" value={feishu.app_secret ?? ""}
              onChange={(v) => setFeishu({ ...feishu, app_secret: v })} />
          </div>
          <ConnectionTest label="Check lark auth" onTest={() => configApi.feishuHealth()} />
          <div className="divide-y divide-border-default rounded border border-border-default px-4">
            {SOURCES.map(({ key, label }) => (
              <ToggleSwitch key={key} id={`cfg-src-${key}`} label={label}
                checked={sources[key] ?? false}
                onChange={(v) => setFeishu({ ...feishu, sources: { ...sources, [key]: v } })} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
