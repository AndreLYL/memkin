import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { configApi } from "../../../api/config";

export function ChannelRefreshSection() {
  const queryClient = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: status, refetch } = useQuery({
    queryKey: ["channel-refresh-status"],
    queryFn: configApi.getRefreshStatus,
    refetchInterval: polling ? 1000 : false,
  });

  // Auto-stop polling when job reaches a terminal state, and invalidate
  // downstream queries so any other view re-fetches.
  useEffect(() => {
    if (!status) return;
    if (status.state === "done" || status.state === "error") {
      setPolling(false);
      queryClient.invalidateQueries({ queryKey: ["channel-names"] });
      queryClient.invalidateQueries({ queryKey: ["timeline-feed"] });
    } else if (status.state === "running") {
      setPolling(true);
    }
  }, [status?.state, queryClient]);

  const handleRefresh = async () => {
    setErrorMsg(null);
    try {
      const result = await configApi.refreshChatNames();
      // 202 returns { jobId }, 409 returns { error: "another refresh is in progress" }.
      // In either case we start polling — the running job (ours or the one already
      // in progress) will be reflected in GET /status.
      setPolling(true);
      await refetch();
      if (result.error && !result.jobId) {
        // Don't show 409 as an error — the polling will attach to the running job.
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const lastRefreshLabel = status?.lastRefreshedAt
    ? new Date(status.lastRefreshedAt).toLocaleString("zh-CN")
    : "从未";
  const unresolvedCount =
    (status?.total ?? 0) - (status?.resolved ?? 0) - (status?.failed ?? 0) - (status?.skipped ?? 0);
  const progressDone = (status?.resolved ?? 0) + (status?.failed ?? 0) + (status?.skipped ?? 0);

  return (
    <div className="rounded-xl bg-bg-surface p-4 shadow-[0_1px_2px_rgba(43,37,33,0.04),0_6px_16px_rgba(43,37,33,0.035)]">
      <h3 className="font-semibold text-fg-default">群名 / 私聊名解析</h3>
      <div className="mt-2 text-sm text-fg-muted">上次刷新：{lastRefreshLabel}</div>
      {status && status.state === "running" && (
        <div className="mt-2 text-sm">
          <div>正在解析 {status.currentChannel ?? "..."}</div>
          <div className="mt-1 h-2 w-full rounded bg-bg-subtle">
            <div
              className="h-full rounded bg-accent transition-all"
              style={{
                width: `${status.total > 0 ? (progressDone / status.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            {progressDone} / {status.total}
          </div>
        </div>
      )}
      {status && status.state !== "running" && (
        <div className="mt-2 text-sm text-fg-muted">
          已解析：{status.resolved} / 共 {status.total} 个 channel
          {unresolvedCount > 0 && ` · ${unresolvedCount} 个未解析`}
        </div>
      )}
      {status && status.errors.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-red-500">{status.errors.length} 个错误</summary>
          <ul className="mt-1 list-disc pl-5 text-xs text-fg-muted">
            {status.errors.slice(0, 10).map((e, i) => (
              <li key={i}>
                <code>{e.channel}</code>: {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      {errorMsg && <div className="mt-2 text-sm text-red-500">{errorMsg}</div>}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={status?.state === "running"}
        className="mt-3 rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {status?.state === "running"
          ? "刷新中…"
          : unresolvedCount > 0
            ? `刷新群名 (${unresolvedCount} 个待解析)`
            : "刷新群名"}
      </button>
    </div>
  );
}
