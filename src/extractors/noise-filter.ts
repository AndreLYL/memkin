/**
 * Noise Filter — Two-level filtering for conversation blocks
 *
 * L1: Rule-based filtering (system notifications, emoji-only, red packets)
 * L2: LLM-based significance judgment
 */

import { z } from "zod";
import type { ConversationBlock } from "../core/types.js";
import { PROMPTS } from "../embedded-assets.generated.js";
import type { LLMProvider } from "./providers/types.js";

export type NoiseFilterVerdict = "pass" | "skip" | "escalate";

// Zod schema for runtime validation of LLM response
const SignificanceVerdictSchema = z.object({
  worth_processing: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  topics: z.array(z.string()),
});

// L1: Rule-based keywords
const SYSTEM_KEYWORDS = [
  "加入群聊",
  "退出群聊",
  "撤回了一条消息",
  "修改群名为",
  "邀请",
  "移出了群聊",
  "你已添加",
];

const RED_PACKET_KEYWORDS = ["[红包]", "[转账]", "收到红包", "收到转账"];

const DECISION_KEYWORDS = ["确定", "同意", "方案", "决定", "批准", "通过", "采用"];

const TASK_KEYWORDS = ["负责", "deadline", "截止", "完成时间", "交付", "你来", "你做", "分配给"];

const EMAIL_SKIP_PATTERNS = [
  /auto[- ]?reply/i,
  /out of office/i,
  /自动回复/,
  /会议取消/,
  /会议已取消/,
];

/**
 * Check if a message content is emoji-only
 */
function isEmojiOnly(content: string): boolean {
  // Remove all emoji and whitespace, if nothing left -> emoji-only
  // Unicode emoji ranges: various blocks (variation selectors handled separately)
  const withoutEmoji = content
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]|️/gu,
      "",
    )
    .replace(/\s+/g, "");

  return withoutEmoji.length === 0 && content.trim().length > 0;
}

/**
 * L1: Rule-based filtering
 * Returns 'skip' if noise detected, 'escalate' if high-priority, null to continue to L2
 */
export function filterNoiseL1(block: ConversationBlock): NoiseFilterVerdict | null {
  const allContent = block.messages.map((m) => m.content).join(" ");
  const channel = block.channel ?? "";

  // Email channel rules
  if (channel.startsWith("mail/")) {
    const isAutoSkip = EMAIL_SKIP_PATTERNS.some((re) => re.test(allContent));
    if (isAutoSkip) return "skip";

    const hasDecisionKeywords = DECISION_KEYWORDS.some((kw) => allContent.includes(kw));
    if (hasDecisionKeywords) return "escalate";

    return null;
  }

  // Document and structured channels always pass through to L2
  if (channel.startsWith("docs/") || channel.startsWith("calendar/") || channel === "tasks") {
    return null;
  }

  // System notifications
  const isSystemNotification = SYSTEM_KEYWORDS.some((keyword) => allContent.includes(keyword));
  if (isSystemNotification) {
    return "skip";
  }

  // Red packets / transfers
  const isRedPacket = RED_PACKET_KEYWORDS.some((keyword) => allContent.includes(keyword));
  if (isRedPacket) {
    return "skip";
  }

  // Emoji-only messages
  const allEmojiOnly = block.messages.every((m) => isEmojiOnly(m.content));
  if (allEmojiOnly) {
    return "skip";
  }

  // Type promotion: Decision keywords
  const hasDecisionKeywords = DECISION_KEYWORDS.some((keyword) => allContent.includes(keyword));
  if (hasDecisionKeywords) {
    return "escalate";
  }

  // Type promotion: Task keywords
  const hasTaskKeywords = TASK_KEYWORDS.some((keyword) => allContent.includes(keyword));
  if (hasTaskKeywords) {
    return "escalate";
  }

  // No rule matched, pass to L2
  return null;
}

/**
 * L2: LLM-based significance judgment
 */
async function filterL2(
  block: ConversationBlock,
  provider: LLMProvider,
): Promise<NoiseFilterVerdict> {
  const promptTemplate = PROMPTS["significance.md"];
  if (promptTemplate === undefined) return "pass";

  // Format conversation block for prompt
  const blockSummary = {
    platform: block.platform,
    channel: block.channel,
    participants: block.participants,
    time_range: `${block.start_time} to ${block.end_time}`,
    messages: block.messages.map((m) => ({
      timestamp: m.timestamp,
      contact: m.contact,
      content: m.content,
    })),
  };

  const prompt = promptTemplate.replace(
    "{CONVERSATION_BLOCK}",
    JSON.stringify(blockSummary, null, 2),
  );

  // Call LLM
  const response = await provider.chat(
    [
      {
        role: "system",
        content: "You are a significance judgment assistant. Always respond with valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    { responseFormat: "json" },
  );

  // Parse and validate response
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    // Try extracting JSON from markdown wrapping
    let s = response.trim();
    s = s.replace(/^`{3,}(?:json|JSON)?\s*\n?/, "");
    s = s.replace(/\n?\s*`{3,}\s*$/, "");
    try {
      parsed = JSON.parse(s.trim());
    } catch {
      return "pass";
    }
  }

  const result = SignificanceVerdictSchema.safeParse(parsed);
  if (!result.success) {
    return "pass";
  }
  const verdict = result.data;

  // Apply filtering rules
  if (!verdict.worth_processing) {
    return "skip";
  }

  if (verdict.confidence < 0.3) {
    return "skip";
  }

  return "pass";
}

/**
 * Main noise filter function
 * Synchronous L1, optional async L2
 *
 * @param block - Conversation block to filter
 * @param provider - Optional LLM provider for L2 (if not provided, L1 only)
 * @returns Verdict: 'pass' | 'skip' | 'escalate'
 */
export function filterNoise(
  block: ConversationBlock,
  provider?: LLMProvider,
): NoiseFilterVerdict | Promise<NoiseFilterVerdict> {
  // L1: Rule-based filtering
  const l1Verdict = filterNoiseL1(block);

  if (l1Verdict !== null) {
    // L1 made a decision, return immediately
    return l1Verdict;
  }

  // No provider -> can't do L2, default to pass
  if (!provider) {
    return "pass";
  }

  // L2: LLM-based judgment
  return filterL2(block, provider);
}

/**
 * Resolve a SignalScore decision to a NoiseFilterVerdict.
 *
 * PRD v2 §4.3.2: admit/drop are decided by the cheap 5-dim score alone;
 * the evaluate band (middle scores) gets a final LLM significance judgment.
 * Fail-open: no provider or LLM failure → pass, never lose data silently.
 */
export async function resolveScoreDecision(
  score: { decision: string },
  block: ConversationBlock,
  provider?: LLMProvider,
): Promise<NoiseFilterVerdict> {
  if (score.decision === "drop") return "skip";
  if (score.decision === "admit") return "pass";

  if (!provider) return "pass";
  try {
    return await filterL2(block, provider);
  } catch {
    return "pass";
  }
}
