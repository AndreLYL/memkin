import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { SignalCard } from "../components/shared/SignalCard";
import { FilterBar } from "../components/shared/FilterBar";
import { EmptyState } from "../components/shared/EmptyState";
import { TYPE_GROUPS } from "../lib/type-groups";
import { channelDisplay, type ChannelStatus } from "../lib/channel-display";

interface Signal {
  slug: string;
  type: string;
  title: string;
  snippet: string;
  date: string;
  platform: string;
  channel: string;
  channel_name: string | null;
  channel_name_status: ChannelStatus;
}

interface Group {
  key: string;
  platform: string;
  channel: string;
  channel_name: string | null;
  channel_name_status: ChannelStatus;
  count: number;
  signals: Signal[];
}

interface Day {
  date: string;
  groups: Group[];
}

interface FeedResponse {
  days: Day[];
  next_cursor: string | null;
}

export function TimelinePage() {
  const [selectedType, setSelectedType] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>();
  const [accumulatedDays, setAccumulatedDays] = useState<Day[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["timeline-feed", { type: selectedType, platform: selectedPlatform, cursor }],
    queryFn: async () => {
      const result = await api.timelineFeed({
        type: selectedType || undefined,
        platform: selectedPlatform || undefined,
        cursor,
      }) as FeedResponse;
      if (cursor) {
        setAccumulatedDays((prev) => [...prev, ...result.days]);
      } else {
        setAccumulatedDays(result.days);
      }
      return result;
    },
  });

  const days = cursor ? accumulatedDays : (data?.days ?? []);

  const channelOptions = useMemo(() => {
    const groups: Array<{ channel: string; display: ReturnType<typeof channelDisplay>; count: number }> = [];
    const dms: typeof groups = [];
    const seen = new Map<string, { display: ReturnType<typeof channelDisplay>; count: number }>();
    for (const day of days) {
      for (const g of day.groups) {
        const existing = seen.get(g.channel);
        const signalCount = g.signals.length;
        if (existing) {
          existing.count += signalCount;
        } else {
          seen.set(g.channel, {
            display: channelDisplay(g.channel, g.channel_name, g.channel_name_status),
            count: signalCount,
          });
        }
      }
    }
    for (const [channel, info] of seen.entries()) {
      if (channel.startsWith("group/")) groups.push({ channel, ...info });
      else if (channel.startsWith("dm/")) dms.push({ channel, ...info });
    }
    return { groups, dms };
  }, [days]);

  const filteredDays = useMemo(() => {
    if (!channelFilter) return days;
    return days
      .map((d) => ({ ...d, groups: d.groups.filter((g) => g.channel === channelFilter) }))
      .filter((d) => d.groups.length > 0);
  }, [days, channelFilter]);

  const toggleGroup = (dayDate: string, groupKey: string) => {
    const key = `${dayDate}:${groupKey}`;
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const typeOptions = Object.keys(TYPE_GROUPS);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-fg-default mb-4">Timeline</h1>

      <div className="flex items-center gap-3 flex-wrap">
        <FilterBar
          typeOptions={typeOptions}
          selectedType={selectedType}
          onTypeChange={(t) => { setSelectedType(t); setCursor(undefined); }}
          platformOptions={["feishu", "claude-code"]}
          selectedPlatform={selectedPlatform}
          onPlatformChange={(p) => { setSelectedPlatform(p); setCursor(undefined); }}
        />

        <select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setCursor(undefined); }}
          className="bg-bg-overlay border border-border-muted rounded px-2 py-1 text-sm text-fg-default"
        >
          <option value="">All Channels</option>
          {channelOptions.groups.length > 0 && (
            <optgroup label="群聊">
              {channelOptions.groups.map(({ channel, display, count }) => (
                <option key={channel} value={channel}>
                  {display.text} ({count} 条)
                </option>
              ))}
            </optgroup>
          )}
          {channelOptions.dms.length > 0 && (
            <optgroup label="私聊">
              {channelOptions.dms.map(({ channel, display, count }) => (
                <option key={channel} value={channel}>
                  {display.text} ({count} 条)
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="mt-6 space-y-6">
        {isLoading && filteredDays.length === 0 ? (
          <div className="text-fg-muted text-center py-8">Loading...</div>
        ) : filteredDays.length === 0 ? (
          <EmptyState title="No signals found" description="Try adjusting your filters or run a sync" />
        ) : (
          filteredDays.map((day) => (
            <div key={day.date}>
              <h2 className="text-sm font-medium text-fg-default mb-3 flex items-center gap-2">
                <span className="text-fg-subtle">📅</span>
                {new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "long", year: "numeric", month: "long", day: "numeric",
                })}
              </h2>
              <div className="space-y-2 pl-4">
                {day.groups.map((group) => {
                  const isExpanded = expandedGroups.has(`${day.date}:${group.key}`);
                  return (
                    <div key={group.key} className="border border-border-default rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleGroup(day.date, group.key)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-bg-surface hover:bg-bg-overlay transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-fg-subtle">{isExpanded ? "▾" : "▸"}</span>
                          {(() => {
                            const display = channelDisplay(group.channel, group.channel_name, group.channel_name_status);
                            const colorClass =
                              display.status === "failed"
                                ? "text-red-500"
                                : display.status === "unresolved"
                                  ? "text-yellow-500"
                                  : "text-fg-default";
                            return (
                              <span className={`text-sm ${colorClass}`} title={display.tooltip}>
                                {display.text}
                              </span>
                            );
                          })()}
                          <span className="text-xs text-fg-muted">({group.platform})</span>
                          <span className="text-xs text-fg-subtle">
                            {group.count} signal{group.count !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="p-2 space-y-1.5 bg-bg-canvas">
                          {group.signals.map((signal) => (
                            <SignalCard
                              key={signal.slug}
                              slug={signal.slug}
                              type={signal.type}
                              title={signal.title}
                              snippet={signal.snippet}
                              date={signal.date}
                              platform={signal.platform}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {data?.next_cursor && (
          <div className="text-center pt-4">
            <button
              onClick={() => setCursor(data.next_cursor!)}
              className="px-4 py-2 bg-bg-surface border border-border-default rounded-lg text-sm text-fg-muted hover:text-fg-default hover:border-border-muted transition-colors"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
