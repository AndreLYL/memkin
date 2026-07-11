import type { WizardConfig } from "../../../api/config";
import { FeishuAuth } from "../../../components/config/FeishuAuth";
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
      <h2 className="font-serif text-xl font-bold text-fg-default">Feishu (Lark) Configuration</h2>

      <ToggleSwitch
        id="feishu-enabled"
        label="I use Feishu / Lark"
        checked={enabled}
        onChange={(v) => updateFeishu({ enabled: v })}
      />

      {enabled && (
        <>
          <p className="text-sm text-fg-muted">
            Authorize Feishu below — no terminal needed. This opens a Feishu approval page; once you
            approve, memkin can read your group chats and docs.
          </p>

          <FeishuAuth />

          <details className="text-sm text-fg-muted">
            <summary className="cursor-pointer">Advanced: app credentials (optional)</summary>
            <div className="mt-2 flex flex-col gap-3">
              <p className="text-sm text-fg-muted">
                Leave these blank if you only extract email, message search, or docs — the
                authorization above covers them. App ID / Secret are only required to read group
                messages, direct messages, calendar, or tasks (these use a Feishu bot token).
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-fg-default">App ID</label>
                <input type="text" value={feishu.app_id ?? ""} onChange={(e) => updateFeishu({ app_id: e.target.value })}
                  placeholder="cli_..." className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
              </div>
              <SecretInput id="feishu-secret" label="App Secret" value={feishu.app_secret ?? ""}
                onChange={(v) => updateFeishu({ app_secret: v })} />
            </div>
          </details>
        </>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {enabled ? "Next →" : "Skip →"}
        </button>
      </div>
    </div>
  );
}
