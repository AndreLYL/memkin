import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { PathInput } from "../../../components/config/PathInput";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

export function StorageSection({ config, onSave }: SectionProps) {
  const [dataDir, setDataDir] = useState(config.store?.data_dir ?? "");
  const [exportDir, setExportDir] = useState(config.adapters?.file?.output_dir ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        store: { data_dir: dataDir },
        adapters: exportDir ? { file: { enabled: true, output_dir: exportDir } } : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">Storage</h3>
        <button type="button" onClick={save} disabled={saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <PathInput id="cfg-data-dir" label="Database Path" value={dataDir} onChange={setDataDir} defaultHint="~/.memoark/data" />
      <PathInput id="cfg-export-dir" label="Markdown Export Directory" value={exportDir} onChange={setExportDir}
        defaultHint="~/Documents/memoark-export" optional />
    </div>
  );
}
