import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configApi } from "../../api/config";
import type { WizardConfig, ConfigDiagnostic } from "../../api/config";
import { AutoFetchSection } from "./sections/AutoFetchSection";
import { BackfillSection } from "./sections/BackfillSection";
import { ChannelRefreshSection } from "./sections/ChannelRefreshSection";

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl bg-bg-surface shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-fg-default">{title}</span>
        <span className="text-fg-muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="border-t border-border-default px-5 py-4">{children}</div>}
    </div>
  );
}

export function FetchPage() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: configApi.getConfig,
  });

  const saveMutation = useMutation({
    mutationFn: (next: WizardConfig) => configApi.saveConfig(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (patch: Partial<WizardConfig>) => {
    setSaveError(null);
    if (!config) return;
    const merged: WizardConfig = { ...config, ...patch };
    const result = await saveMutation.mutateAsync(merged);
    if (!result.ok) {
      setSaveError(
        result.diagnostics
          .filter((d: ConfigDiagnostic) => d.severity === "error")
          .map((d: ConfigDiagnostic) => d.message)
          .join(", "),
      );
    }
  };

  if (isLoading || !config) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-fg-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 font-serif text-2xl font-bold text-fg-default">数据抓取</h1>

      {saveError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <ChannelRefreshSection />
        <Section title="定时抓取（Auto-fetch）">
          <AutoFetchSection config={config} onSave={handleSave} />
        </Section>
        <Section title="历史回溯">
          <BackfillSection />
        </Section>
      </div>
    </div>
  );
}
