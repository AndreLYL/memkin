import type { WizardConfig, WizardFeishuSources } from "../../../api/config";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

const SOURCE_LIST: { key: keyof WizardFeishuSources; label: string; description: string }[] = [
  { key: "dm", label: "Direct Messages", description: "Private 1-on-1 chats" },
  { key: "messages", label: "Group Messages", description: "Messages from selected group chats" },
  { key: "mail", label: "Email (Mail)", description: "Feishu inbox emails" },
  { key: "docs", label: "Docs", description: "Feishu documents and wikis" },
  { key: "tasks", label: "Tasks", description: "Feishu task items" },
  { key: "calendar", label: "Calendar", description: "Calendar events" },
];

export function FeishuSources({ config, onUpdate, onNext, onBack }: StepProps) {
  const feishu = config.sources?.feishu ?? {};
  const sources = feishu.sources ?? {};

  const toggle = (key: keyof WizardFeishuSources, value: boolean) =>
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, sources: { ...sources, [key]: value } } } });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-fg-default">Feishu Data Sources</h2>
      <p className="text-sm text-fg-muted">Choose which Feishu data types to extract.</p>

      <div className="divide-y divide-border-default rounded border border-border-default px-4">
        {SOURCE_LIST.map(({ key, label, description }) => (
          <ToggleSwitch
            key={key}
            id={`feishu-src-${key}`}
            label={label}
            description={description}
            checked={sources[key] ?? false}
            onChange={(v) => toggle(key, v)}
          />
        ))}
      </div>

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Next →</button>
      </div>
    </div>
  );
}
