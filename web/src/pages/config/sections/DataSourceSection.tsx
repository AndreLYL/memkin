import { useState } from "react";
import type { FeishuGroup, WizardConfig, WizardFeishuSources } from "../../../api/config";
import { configApi } from "../../../api/config";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";
import type { FetchMode } from "../lib/fetch-mode";
import { applyFetchMode, fetchModeFromConfig } from "../lib/fetch-mode";
import { setChatIds, toggleFeishuSubSource, toggleTopSource } from "../lib/source-patch";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

// Top-level source toggles
const TOP_SOURCES: { id: string; label: string }[] = [
  { id: "feishu", label: "飞书" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "hermes", label: "Hermes" },
];

// Feishu sub-source toggles
const FEISHU_SUB_SOURCES: { key: keyof WizardFeishuSources; label: string }[] = [
  { key: "dm", label: "私聊" },
  { key: "messages", label: "群聊" },
  { key: "mail", label: "邮件" },
  { key: "calendar", label: "日历" },
  { key: "tasks", label: "任务" },
  { key: "docs", label: "云文档" },
];

function mergePartial(base: WizardConfig, patch: Partial<WizardConfig>): WizardConfig {
  return {
    ...base,
    ...patch,
    sources: {
      ...base.sources,
      ...patch.sources,
      feishu: {
        ...(base.sources?.feishu ?? {}),
        ...(patch.sources?.feishu ?? {}),
        sources: {
          ...(base.sources?.feishu?.sources ?? {}),
          ...(patch.sources?.feishu?.sources ?? {}),
        },
      },
    } as WizardConfig["sources"],
  };
}

export function DataSourceSection({ config, onSave }: SectionProps) {
  const [draft, setDraft] = useState<WizardConfig>(config);
  const [saving, setSaving] = useState(false);

  // Group fetch state
  const [groups, setGroups] = useState<FeishuGroup[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState(
    () => (config.sources?.feishu?.chat_ids ?? []).join("\n"),
  );
  const [groupSearch, setGroupSearch] = useState("");

  const mode: FetchMode = fetchModeFromConfig(draft);

  const applyPatch = (patch: Partial<WizardConfig>) => {
    setDraft((prev) => mergePartial(prev, patch));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ sources: draft.sources });
    } finally {
      setSaving(false);
    }
  };

  // ── Fetch mode ──────────────────────────────────────────────────────────────

  const handleModeChange = (newMode: FetchMode) => {
    applyPatch(applyFetchMode(draft, newMode));
  };

  // ── Top-level sources ────────────────────────────────────────────────────────

  const topSourceEnabled = (id: string): boolean => {
    if (id === "feishu") return draft.sources?.feishu?.enabled ?? false;
    const sources = draft.sources as Record<string, { enabled?: boolean } | undefined> | undefined;
    return sources?.[id]?.enabled ?? false;
  };

  const handleTopSourceToggle = (id: string, on: boolean) => {
    if (id === "feishu") {
      applyPatch({
        sources: {
          ...draft.sources,
          feishu: { ...(draft.sources?.feishu ?? {}), enabled: on },
        } as WizardConfig["sources"],
      });
    } else {
      applyPatch(toggleTopSource(draft, id, on));
    }
  };

  // ── Feishu sub-sources ───────────────────────────────────────────────────────

  const feishuSubEnabled = (key: keyof WizardFeishuSources): boolean =>
    draft.sources?.feishu?.sources?.[key] ?? false;

  const handleFeishuSubToggle = (key: string, on: boolean) => {
    applyPatch(toggleFeishuSubSource(draft, key, on));
  };

  // ── Group selection ──────────────────────────────────────────────────────────

  const selectedIds = draft.sources?.feishu?.chat_ids ?? [];

  const fetchGroups = async () => {
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const result = await configApi.feishuGroups();
      if ("error" in result && result.error) {
        setGroupsError(result.error);
        setManualMode(true);
      } else if ("groups" in result && result.groups) {
        setGroups(result.groups);
      }
    } catch (err) {
      setGroupsError(err instanceof Error ? err.message : String(err));
      setManualMode(true);
    } finally {
      setGroupsLoading(false);
    }
  };

  const toggleGroup = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    applyPatch(setChatIds(draft, next));
  };

  const saveManualInput = () => {
    const ids = manualInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    applyPatch(setChatIds(draft, ids));
  };

  const filteredGroups = groups
    ? groups.filter(
        (g) =>
          g.name.toLowerCase().includes(groupSearch.toLowerCase()) ||
          g.id.toLowerCase().includes(groupSearch.toLowerCase()),
      )
    : null;

  const feishuEnabled = topSourceEnabled("feishu");
  const messagesEnabled = feishuSubEnabled("messages");

  return (
    <div className="flex flex-col gap-6">
      {/* Header + Save */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg-default">数据来源</h3>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {/* ── 抓取范围模式 ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-fg-default">抓取范围模式</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleModeChange("autonomous")}
            className={`flex-1 rounded border px-4 py-3 text-left text-sm transition-colors ${
              mode === "autonomous"
                ? "border-accent bg-bg-overlay text-accent"
                : "border-border-default bg-bg-default text-fg-default hover:bg-bg-subtle"
            }`}
          >
            <span className="font-medium">自主全量</span>
            <p className="mt-0.5 text-xs text-fg-muted">
              抓所有群，新群自动纳入，无需手动维护
            </p>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("curated")}
            className={`flex-1 rounded border px-4 py-3 text-left text-sm transition-colors ${
              mode === "curated"
                ? "border-accent bg-bg-overlay text-accent"
                : "border-border-default bg-bg-default text-fg-default hover:bg-bg-subtle"
            }`}
          >
            <span className="font-medium">精选可控</span>
            <p className="mt-0.5 text-xs text-fg-muted">
              只抓勾选的群，精细管控抓取范围
            </p>
          </button>
        </div>
      </div>

      {/* ── 顶层数据源 ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg-default">数据源</p>
        <div className="divide-y divide-border-default rounded border border-border-default px-4">
          {TOP_SOURCES.map(({ id, label }) => (
            <ToggleSwitch
              key={id}
              id={`cfg-top-src-${id}`}
              label={label}
              checked={topSourceEnabled(id)}
              onChange={(v) => handleTopSourceToggle(id, v)}
            />
          ))}
        </div>
      </div>

      {/* ── 飞书子源 (only when feishu enabled) ──────────────────────────────── */}
      {feishuEnabled && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-fg-default">飞书内容类型</p>
          <div className="divide-y divide-border-default rounded border border-border-default px-4">
            {FEISHU_SUB_SOURCES.map(({ key, label }) => (
              <ToggleSwitch
                key={key}
                id={`cfg-feishu-sub-${key}`}
                label={label}
                checked={feishuSubEnabled(key)}
                onChange={(v) => handleFeishuSubToggle(key, v)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 群聊选择 (only curated + feishu enabled + messages enabled) ─────── */}
      {feishuEnabled && messagesEnabled && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-fg-default">群聊选择</p>

          {mode === "autonomous" ? (
            <div className="rounded border border-border-default bg-bg-subtle px-4 py-3 text-sm text-fg-muted">
              自主全量模式：抓取所有群 + 新群自动纳入，无需挑选
            </div>
          ) : (
            <>
              {groupsError && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  获取群列表失败：{groupsError}
                </div>
              )}

              {!groups && !manualMode && (
                <button
                  type="button"
                  onClick={fetchGroups}
                  disabled={groupsLoading}
                  className="self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {groupsLoading ? "获取中…" : "获取群列表"}
                </button>
              )}

              {groups && !manualMode && (
                <>
                  <input
                    type="text"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="搜索群名或 ID…"
                    className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
                  />
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border border-border-default p-3">
                    {filteredGroups && filteredGroups.length > 0 ? (
                      filteredGroups.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(g.id)}
                            onChange={() => toggleGroup(g.id)}
                            className="rounded"
                          />
                          <span className="text-sm text-fg-default">{g.name}</span>
                          <span className="text-xs text-fg-muted">{g.id}</span>
                        </label>
                      ))
                    ) : (
                      <p className="text-sm text-fg-muted">无匹配群</p>
                    )}
                  </div>
                </>
              )}

              {manualMode && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-fg-default">
                    群 ID（每行一个，或用逗号分隔）
                  </label>
                  <textarea
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    onBlur={saveManualInput}
                    rows={4}
                    placeholder={"oc_abc123\noc_def456"}
                    className="rounded border border-border-default bg-bg-default px-3 py-2 font-mono text-sm text-fg-default"
                  />
                </div>
              )}

              {!manualMode && (
                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="self-start text-xs text-accent underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  手动输入群 ID
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
