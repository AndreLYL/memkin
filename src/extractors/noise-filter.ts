import type { ConversationBlock, SignalScore } from "../core/types.js";

export type NoiseFilterVerdict = "pass" | "skip" | "escalate";

const SYSTEM_KEYWORDS = [
  "加入群聊",
  "退出群聊",
  "撤回了一条消息",
  "修改群名为",
  "移出了群聊",
  "你已添加",
];

const RED_PACKET_KEYWORDS = ["[红包]", "[转账]", "收到红包", "收到转账"];

const DECISION_KEYWORDS = ["确定", "同意", "方案", "决定", "批准", "通过", "采用"];

const TASK_KEYWORDS = ["负责", "deadline", "截止", "完成时间", "交付", "你来", "你做", "分配给"];

const EMAIL_SKIP_KEYWORDS = ["auto-reply", "out of office", "自动回复", "会议取消", "meeting cancelled"];

function isEmojiOnly(content: string): boolean {
  const withoutEmoji = content
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]|️/gu,
      "",
    )
    .replace(/\s+/g, "");
  return withoutEmoji.length === 0 && content.trim().length > 0;
}

export function filterNoiseL1(block: ConversationBlock): NoiseFilterVerdict | null {
  const channel = block.channel;
  const allContent = block.messages.map(m => m.content).join(" ");
  const contentLower = allContent.toLowerCase();

  if (channel.startsWith("mail/")) {
    if (EMAIL_SKIP_KEYWORDS.some(kw => contentLower.includes(kw.toLowerCase()))) {
      return "skip";
    }
    if (DECISION_KEYWORDS.some(kw => allContent.includes(kw))) return "escalate";
    if (TASK_KEYWORDS.some(kw => allContent.includes(kw))) return "escalate";
    return null;
  }

  if (channel.startsWith("docs/")) {
    return null;
  }

  if (channel.startsWith("calendar/") || channel === "tasks") {
    return null;
  }

  // Chat/DM
  if (SYSTEM_KEYWORDS.some(kw => allContent.includes(kw))) return "skip";
  if (RED_PACKET_KEYWORDS.some(kw => allContent.includes(kw))) return "skip";
  if (block.messages.every(m => isEmojiOnly(m.content))) return "skip";
  if (DECISION_KEYWORDS.some(kw => allContent.includes(kw))) return "escalate";
  if (TASK_KEYWORDS.some(kw => allContent.includes(kw))) return "escalate";

  return null;
}

export function mapScoreDecision(score: SignalScore): NoiseFilterVerdict {
  if (score.decision === "drop") return "skip";
  return "pass";
}
