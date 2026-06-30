import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ConfigDiagnostic, DaemonStatus, WizardConfig } from "../../api/config";
import { configApi } from "../../api/config";
import { AutoFetchSection } from "../fetch/sections/AutoFetchSection";
import { BackfillSection } from "../fetch/sections/BackfillSection";
import { DataSourceSection } from "./sections/DataSourceSection";
import { EmbeddingSection } from "./sections/EmbeddingSection";
import { FeishuSection } from "./sections/FeishuSection";
import { LLMSection } from "./sections/LLMSection";
import { StorageSection } from "./sections/StorageSection";

/** Format an ISO datetime string as a short relative label (e.g. "2 分钟后"). */
function formatRelative(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return diff >= 0 ? "即将开始" : "刚刚";
  if (mins < 60) return diff >= 0 ? `${mins} 分钟后` : `${mins} 分钟前`;
  const hrs = Math.round(abs / 3_600_000);
  return diff >= 0 ? `${hrs} 小时后` : `${hrs} 小时前`;
}

function DaemonBanner({ status }: { status: DaemonStatus | undefined }) {
  if (status?.running) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-border-default bg-bg-subtle px-4 py-3 text-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-green-500 shrink-0" />
        <span className="text-fg-default font-medium">后台运行中</span>
        {status.next_scheduled && (
          <span className="text-fg-muted">
            · 下次抓取 {formatRelative(status.next_scheduled)}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-border-default bg-bg-subtle px-4 py-3 text-sm text-fg-muted">
      后台抓取未启用 — 在下方「定时抓取」开启
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-bg-surface rounded-xl shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="font-serif font-semibold text-fg-default">{title}</span>
        {open
          ? <ChevronUp size={16} strokeWidth={1.75} className="text-fg-muted" />
          : <ChevronDown size={16} strokeWidth={1.75} className="text-fg-muted" />
        }
      </button>
      {open && <div className="border-t border-border-default px-5 py-4">{children}</div>}
    </div>
  );
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: configApi.getConfig,
  });

  // Poll daemon status every 30 s; errors silently fall back to the "not running" banner.
  const { data: daemonStatus } = useQuery({
    queryKey: ["daemon-status"],
    queryFn: configApi.getDaemonStatus,
    refetchInterval: 30_000,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (next: WizardConfig) => configApi.saveConfig(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (patch: Partial<WizardConfig>) => {
    setSaveError(null);
    const merged: WizardConfig = { ...config, ...patch };
    const result = await saveMutation.mutateAsync(merged);
    if (!result.ok) {
      setSaveError(result.diagnostics.filter((d: ConfigDiagnostic) => d.severity === "error").map((d: ConfigDiagnostic) => d.message).join(", "));
    }
  };

  if (isLoading || !config) {
    return <div className="flex items-center justify-center min-h-screen text-fg-muted">Loading configuration...</div>;
  }

  return (
    <div className="min-h-screen bg-bg-canvas px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="font-serif text-2xl font-bold text-fg-default mb-6">Configuration</h1>

        <DaemonBanner status={daemonStatus} />

        {saveError && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Section title="LLM"><LLMSection config={config} onSave={handleSave} /></Section>
          <Section title="Embedding"><EmbeddingSection config={config} onSave={handleSave} /></Section>
          <Section title="飞书凭证"><FeishuSection config={config} onSave={handleSave} /></Section>
          <Section title="数据源"><DataSourceSection config={config} onSave={handleSave} /></Section>
          <Section title="定时抓取（Auto-fetch）"><AutoFetchSection config={config} onSave={handleSave} /></Section>
          <Section title="存储"><StorageSection config={config} onSave={handleSave} /></Section>
          <Section title="历史回溯"><BackfillSection /></Section>
        </div>
      </div>
    </div>
  );
}
