import { useEffect, useRef, useState } from "react";
import { backfillApi } from "../../../api/backfill";
import type { BackfillSourceType, BackfillStatus, CoverageBucket } from "../../../api/backfill";

const WEEKS = 104;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const SOURCE_LABELS: Record<BackfillSourceType, string> = {
  messages: "群聊消息",
  dm: "DM",
  mail: "邮件",
  message_search: "消息搜索",
};

const ALL_SOURCES: BackfillSourceType[] = ["messages", "dm", "mail", "message_search"];

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function monthsAgo(ms: number): string {
  const months = Math.round((Date.now() - ms) / (30 * 24 * 60 * 60 * 1000));
  if (months < 1) return "不到 1 个月前";
  if (months === 1) return "约 1 个月前";
  return `约 ${months} 个月前`;
}

function CoverageHeatmap({
  buckets,
  sliderValue,
  onSliderChange,
}: {
  buckets: CoverageBucket[];
  sliderValue: number;
  onSliderChange: (v: number) => void;
}) {
  const now = Date.now();
  const countByIdx = new Map<number, number>();
  let maxCount = 0;
  for (const b of buckets) {
    const weeksAgo = Math.floor((now - b.week_start) / MS_PER_WEEK);
    if (weeksAgo >= 0 && weeksAgo < WEEKS) {
      const idx = WEEKS - 1 - weeksAgo;
      countByIdx.set(idx, b.count);
      if (b.count > maxCount) maxCount = b.count;
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-fg-muted">
        时间线条目密度（飞书）— 空白格表示该周无时间线事件，非未抓取
      </p>
      <div className="relative">
        <div className="flex gap-[2px]">
          {Array.from({ length: WEEKS }, (_, i) => {
            const count = countByIdx.get(i) ?? 0;
            const intensity = maxCount > 0 ? count / maxCount : 0;
            const bg =
              count === 0
                ? undefined
                : `rgba(37,99,235,${0.15 + intensity * 0.85})`;
            return (
              <div
                key={i}
                title={`${count} 条`}
                className={`h-4 flex-1 rounded-sm ${count === 0 ? "bg-gray-100 dark:bg-gray-800" : ""}`}
                style={bg ? { backgroundColor: bg } : undefined}
              />
            );
          })}
        </div>
        <input
          type="range"
          min={0}
          max={WEEKS}
          value={sliderValue}
          onChange={(e) => onSliderChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ WebkitAppearance: "none" } as React.CSSProperties}
        />
        <div
          className="pointer-events-none absolute top-0 h-full w-[2px] bg-blue-500"
          style={{ left: `${(sliderValue / WEEKS) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>2 年前</span>
        <span>今天</span>
      </div>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        className="h-full rounded-full bg-blue-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function BackfillSection() {
  const [buckets, setBuckets] = useState<CoverageBucket[]>([]);
  const [sliderValue, setSliderValue] = useState(52);
  const [selectedSources, setSelectedSources] = useState<Set<BackfillSourceType>>(
    new Set(ALL_SOURCES),
  );
  const [status, setStatus] = useState<BackfillStatus>({
    state: "idle",
    sources: [],
    total_messages: 0,
    total_blocks: 0,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStateRef = useRef<string>("idle");

  useEffect(() => {
    backfillApi.getCoverage().then((res) => setBuckets(res.buckets)).catch(() => {});
  }, []);

  useEffect(() => {
    if (prevStateRef.current !== "done" && status.state === "done") {
      backfillApi.getCoverage().then((res) => setBuckets(res.buckets)).catch(() => {});
    }
    prevStateRef.current = status.state;
  }, [status.state]);

  useEffect(() => {
    if (status.state === "running") {
      pollRef.current = setInterval(() => {
        backfillApi.getStatus().then(setStatus).catch(() => {});
      }, 2000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status.state]);

  const now = Date.now();
  const sinceMs = now - (WEEKS - sliderValue) * MS_PER_WEEK;
  const maxProcessed = Math.max(1, ...status.sources.map((s) => s.processed));
  const elapsedMs =
    status.started_at
      ? (status.finished_at ?? Date.now()) - status.started_at
      : 0;

  const handleStart = async () => {
    const types = ALL_SOURCES.filter((t) => selectedSources.has(t));
    if (types.length === 0) return;
    await backfillApi.start(sinceMs, types);
    const s = await backfillApi.getStatus();
    setStatus(s);
  };

  const handleCancel = async () => {
    await backfillApi.cancel();
    const s = await backfillApi.getStatus();
    setStatus(s);
  };

  const handleReset = async () => {
    await backfillApi.reset();
    const s = await backfillApi.getStatus();
    setStatus(s);
  };

  const toggleSource = (src: BackfillSourceType) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <CoverageHeatmap
        buckets={buckets}
        sliderValue={sliderValue}
        onSliderChange={setSliderValue}
      />

      {status.state === "idle" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-default">
            回溯起始：<strong>{formatDate(sinceMs)}</strong>（{monthsAgo(sinceMs)}）
          </p>
          <div className="flex flex-wrap gap-3">
            {ALL_SOURCES.map((src) => (
              <label key={src} className="flex items-center gap-1.5 text-sm text-fg-default">
                <input
                  type="checkbox"
                  checked={selectedSources.has(src)}
                  onChange={() => toggleSource(src)}
                  className="h-4 w-4 rounded border-border-default"
                />
                {SOURCE_LABELS[src]}
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleStart}
              disabled={selectedSources.size === 0}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              开始回溯
            </button>
          </div>
        </div>
      )}

      {status.state === "running" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg-default">
              ■ 正在回溯… 已用时 {formatDuration(elapsedMs)}
            </span>
            <button
              onClick={handleCancel}
              className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              取消
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {status.sources.map((src) => (
              <div key={src.source} className="flex items-center gap-3">
                <span className="w-24 text-sm text-fg-default">{SOURCE_LABELS[src.source]}</span>
                <div className="flex-1">
                  {src.status === "pending" ? (
                    <div className="h-2 w-full rounded-full bg-gray-100" />
                  ) : (
                    <ProgressBar value={src.processed} max={maxProcessed} />
                  )}
                </div>
                <span className="w-16 text-right text-xs text-fg-muted">
                  {src.status !== "pending" ? `${src.processed} 条` : ""}
                </span>
                <span
                  className={`w-16 text-right text-xs ${
                    src.status === "error"
                      ? "text-red-500"
                      : src.status === "done"
                        ? "text-green-600"
                        : "text-fg-muted"
                  }`}
                >
                  {src.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status.state === "done" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-green-600">
            ✓ 回溯完成（{formatDuration(elapsedMs)}）
          </p>
          <p className="text-sm text-fg-muted">
            共抓取 {status.total_messages} 条消息 → 生成 {status.total_blocks} 个 block
          </p>
          <div className="flex justify-end">
            <button
              onClick={handleReset}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              再次回溯
            </button>
          </div>
        </div>
      )}

      {status.state === "error" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-red-600">
            ✗ {status.error === "cancelled" ? "任务已取消" : `出错：${status.error}`}
          </p>
          <div className="flex justify-end">
            <button
              onClick={handleReset}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              重新开始
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
