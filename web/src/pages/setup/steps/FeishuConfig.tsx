import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ConnectionTest } from "../../../components/config/ConnectionTest";
import { SecretInput } from "../../../components/config/SecretInput";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function FeishuConfig({ config, onUpdate, onNext, onBack }: StepProps) {
  const feishu = config.sources?.feishu ?? {};
  const enabled = feishu.enabled ?? false;

  const updateFeishu = (patch: object) =>
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, ...patch } } });

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Feishu (Lark) Configuration</h2>

      <ToggleSwitch
        id="feishu-enabled"
        label="I use Feishu / Lark"
        checked={enabled}
        onChange={(v) => updateFeishu({ enabled: v })}
      />

      {enabled && (
        <>
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>Prerequisite:</strong> Feishu data access requires the <code>lark</code> CLI
            binary to be installed and authenticated. Run the lark CLI login command (see lark-cli
            documentation) in your terminal before proceeding.
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-fg-default">App ID</label>
            <input type="text" value={feishu.app_id ?? ""} onChange={(e) => updateFeishu({ app_id: e.target.value })}
              placeholder="cli_..." className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
          </div>

          <SecretInput id="feishu-secret" label="App Secret" value={feishu.app_secret ?? ""}
            onChange={(v) => updateFeishu({ app_secret: v })} />

          <div>
            <p className="text-sm font-medium text-fg-default mb-2">lark auth status</p>
            <ConnectionTest
              label="Check lark auth"
              onTest={() => configApi.feishuHealth()}
            />
          </div>
        </>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {enabled ? "Next →" : "Skip →"}
        </button>
      </div>
    </div>
  );
}
