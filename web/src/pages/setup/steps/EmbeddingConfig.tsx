import type { WizardConfig, WizardEmbeddingConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ConnectionTest } from "../../../components/config/ConnectionTest";
import { SecretInput } from "../../../components/config/SecretInput";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function EmbeddingConfig({ config, onUpdate, onNext, onBack }: StepProps) {
  const emb = config.embedding ?? { provider: "openai" as const, model: "text-embedding-3-large", dimensions: 1536, base_url: "https://api.openai.com/v1", api_key: "" };

  const update = (patch: Partial<WizardEmbeddingConfig>) =>
    onUpdate({ embedding: { ...emb, ...patch } });

  const isOllama = emb.provider === "ollama";

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Embedding Configuration</h2>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Provider</label>
        <select
          value={emb.provider}
          onChange={(e) => {
            if (e.target.value === "ollama") {
              update({ provider: "ollama", model: "nomic-embed-text", dimensions: 768, base_url: "http://localhost:11434", api_key: undefined });
            } else {
              update({ provider: "openai", model: "text-embedding-3-large", dimensions: 1536, base_url: "https://api.openai.com/v1" });
            }
          }}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        >
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-sm font-medium text-fg-default">Model</label>
          <input type="text" value={emb.model ?? ""} onChange={(e) => update({ model: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
        </div>
        <div className="w-24 flex flex-col gap-1">
          <label className="text-sm font-medium text-fg-default">Dimensions</label>
          <input type="number" value={emb.dimensions ?? ""} onChange={(e) => update({ dimensions: Number(e.target.value) })}
            className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Base URL</label>
        <input type="text" value={emb.base_url ?? ""} onChange={(e) => update({ base_url: e.target.value })}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
      </div>

      {!isOllama && (
        <SecretInput id="emb-api-key" label="API Key" value={emb.api_key ?? ""} onChange={(v) => update({ api_key: v })} required />
      )}

      <ConnectionTest onTest={() => configApi.testEmbedding({ provider: emb.provider, base_url: emb.base_url, api_key: emb.api_key })} />

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Next →</button>
      </div>
    </div>
  );
}
