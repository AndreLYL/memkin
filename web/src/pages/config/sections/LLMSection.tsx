import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ConnectionTest } from "../../../components/config/ConnectionTest";
import { SecretInput } from "../../../components/config/SecretInput";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

export function LLMSection({ config, onSave }: SectionProps) {
  const [llm, setLlm] = useState(config.llm ?? { provider: "openai", model: "", base_url: "", api_key: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave({ llm }); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">LLM</h3>
        <button type="button" onClick={save} disabled={saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Provider</label>
          <input type="text" value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Model</label>
          <input type="text" value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Base URL</label>
        <input type="text" value={llm.base_url ?? ""} onChange={(e) => setLlm({ ...llm, base_url: e.target.value })}
          className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
      </div>
      <SecretInput id="cfg-llm-key" label="API Key" value={llm.api_key ?? ""} onChange={(v) => setLlm({ ...llm, api_key: v })} />
      <ConnectionTest onTest={() => configApi.testLLM(llm)} />
    </div>
  );
}
