import type { WizardConfig } from "../../../api/config";
import { PathInput } from "../../../components/config/PathInput";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function StoragePaths({ config, onUpdate, onNext, onBack }: StepProps) {
  const dataDir = config.store?.data_dir ?? "";
  const exportDir = config.adapters?.file?.output_dir ?? "";

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-serif text-xl font-bold text-fg-default">Storage Paths</h2>

      <PathInput
        id="data-dir"
        label="Database Path"
        value={dataDir}
        onChange={(v) => onUpdate({ store: { data_dir: v } })}
        defaultHint="~/.memoark/data"
      />

      <PathInput
        id="export-dir"
        label="Markdown Export Directory"
        value={exportDir}
        onChange={(v) => onUpdate({ adapters: { file: { enabled: Boolean(v), output_dir: v } } })}
        defaultHint="~/Documents/memoark-export"
        optional
      />

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Next →</button>
      </div>
    </div>
  );
}
