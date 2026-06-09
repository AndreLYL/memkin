import type { WizardConfig, WizardLLMConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ConnectionTest } from "../../../components/config/ConnectionTest";
import { SecretInput } from "../../../components/config/SecretInput";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { value: "anthropic", label: "Anthropic", defaultUrl: "https://api.anthropic.com", defaultModel: "claude-3-haiku-20240307" },
  { value: "custom", label: "Custom / Proxy", defaultUrl: "", defaultModel: "" },
];

export function LLMConfig({ config, onUpdate, onNext, onBack }: StepProps) {
  const llm = config.llm ?? { provider: "openai", model: "gpt-4o-mini", base_url: "https://api.openai.com/v1", api_key: "" };

  const update = (patch: Partial<WizardLLMConfig>) =>
    onUpdate({ llm: { ...llm, ...patch } });

  const selectedProvider = PROVIDERS.find((p) => p.value === llm.provider) ?? PROVIDERS[2];

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">LLM Configuration</h2>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Provider</label>
        <select
          value={llm.provider}
          onChange={(e) => {
            const p = PROVIDERS.find((x) => x.value === e.target.value) ?? PROVIDERS[0];
            update({ provider: p.value, base_url: p.defaultUrl, model: p.defaultModel });
          }}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Model <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={llm.model ?? ""}
          onChange={(e) => update({ model: e.target.value })}
          placeholder={selectedProvider.defaultModel}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Base URL</label>
        <input
          type="text"
          value={llm.base_url ?? ""}
          onChange={(e) => update({ base_url: e.target.value })}
          placeholder={selectedProvider.defaultUrl}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        />
      </div>

      <SecretInput
        id="llm-api-key"
        label="API Key"
        value={llm.api_key ?? ""}
        onChange={(v) => update({ api_key: v })}
        placeholder="sk-..."
        required
      />

      <ConnectionTest
        onTest={() => configApi.testLLM(llm as WizardLLMConfig)}
      />

      <div className="flex justify-between pt-2">
        {onBack && (
          <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>
        )}
        <button
          onClick={onNext}
          disabled={!llm.model || !llm.api_key}
          className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
