export type ChannelStatus = "resolved" | "unresolved" | "failed" | "mail";

export interface ChannelDisplay {
  text: string;
  tooltip: string;
  status: ChannelStatus;
}

/**
 * Compute the visual presentation of a Feishu channel.
 *
 * @param channel        Raw channel string from frontmatter (e.g. "group/oc_xxx").
 * @param cachedName     Display name from identity_cache (may be null when failed or unresolved).
 * @param status         Resolution status from backend (timeline_feed: channel_name_status; batch: results[].status).
 */
export function channelDisplay(
  channel: string,
  cachedName: string | null,
  status: ChannelStatus,
): ChannelDisplay {
  if (status === "mail") {
    return { text: "📧 邮件", tooltip: channel, status: "mail" };
  }
  if (status === "resolved" && cachedName) {
    return { text: cachedName, tooltip: channel, status: "resolved" };
  }
  if (status === "failed") {
    return {
      text: `${channel} ✕`,
      tooltip: "解析失败 — 群可能已解散或权限不足",
      status: "failed",
    };
  }
  // unresolved or any unexpected state
  return {
    text: `${channel} ⚠`,
    tooltip: "未解析 — 点击 Fetch 页「刷新群名」",
    status: "unresolved",
  };
}
