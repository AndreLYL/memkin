import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ConnectionTest } from "../../../components/config/ConnectionTest";
import { SecretInput } from "../../../components/config/SecretInput";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

export function EmbeddingSection({ config, onSave }: SectionProps) {
  const [emb, setEmb] = useState(config.embedding ?? { provider: "openai" as const, model: "", dimensions: 1536, base_url: "", api_key: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave({ embedding: emb }); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">Embedding</h3>
        <button type="button" onClick={save} disabled={saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Provider</label>
          <select value={emb.provider} onChange={(e) => setEmb({ ...emb, provider: e.target.value as "openai" | "ollama" })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default">
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Model</label>
          <input type="text" value={emb.model} onChange={(e) => setEmb({ ...emb, model: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Dimensions</label>
          <input type="number" value={emb.dimensions} onChange={(e) => setEmb({ ...emb, dimensions: Number(e.target.value) })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Base URL</label>
        <input type="text" value={emb.base_url ?? ""} onChange={(e) => setEmb({ ...emb, base_url: e.target.value })}
          className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
      </div>
      {emb.provider === "openai" && (
        <SecretInput id="cfg-emb-key" label="API Key" value={emb.api_key ?? ""} onChange={(v) => setEmb({ ...emb, api_key: v })} />
      )}
      <ConnectionTest onTest={() => configApi.testEmbedding({ provider: emb.provider, base_url: emb.base_url, api_key: emb.api_key })} />
    </div>
  );
}
