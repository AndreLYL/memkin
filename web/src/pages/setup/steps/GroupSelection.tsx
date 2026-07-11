import { useState } from "react";
import type { FeishuGroup, WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { FeishuAuth } from "../../../components/config/FeishuAuth";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function GroupSelection({ config, onUpdate, onNext, onBack }: StepProps) {
  const [groups, setGroups] = useState<FeishuGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);

  const feishu = config.sources?.feishu ?? {};
  const selectedIds = feishu.chat_ids ?? [];

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    setNeedsAuth(false);
    try {
      const result = await configApi.feishuGroups();
      if (result.error) {
        setError(result.error);
        setNeedsAuth(Boolean(result.needsAuth));
        setManualMode(true);
      } else if (result.groups) {
        setGroups(result.groups);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setManualMode(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, chat_ids: next } } });
  };

  const saveManual = () => {
    const ids = manualInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, chat_ids: ids } } });
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-serif text-xl font-bold text-fg-default">Select Group Chats</h2>
      <p className="text-sm text-fg-muted">Choose which group chats to extract messages from.</p>

      {!groups && !manualMode && (
        <button
          onClick={fetchGroups}
          disabled={loading}
          className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {loading ? "Fetching..." : "Fetch My Group List"}
        </button>
      )}

      {error && (
        <div className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>{error}</span>
          {needsAuth && <FeishuAuth />}
          <span className="text-xs text-amber-700">
            You can also enter group IDs by hand below, or just click Next to skip Feishu for now.
          </span>
        </div>
      )}

      {groups && !manualMode && (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto rounded border border-border-default p-3">
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.includes(g.id)}
                onChange={() => toggleGroup(g.id)}
                className="rounded"
              />
              <span className="text-sm text-fg-default">{g.name}</span>
              <span className="text-xs text-fg-muted">{g.id}</span>
            </label>
          ))}
        </div>
      )}

      {manualMode && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-fg-default">Group IDs (one per line)</label>
          <textarea
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onBlur={saveManual}
            rows={4}
            placeholder={"oc_abc123\noc_def456"}
            className="rounded border border-border-default bg-bg-default px-3 py-2 text-sm text-fg-default font-mono"
          />
        </div>
      )}

      {!manualMode && (
        <button type="button" onClick={() => setManualMode(true)} className="self-start text-xs text-accent underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Enter Group IDs manually instead
        </button>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Next →</button>
      </div>
    </div>
  );
}
