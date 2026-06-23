import { missingFieldRule } from "../gaps.js";
import type { IntentTemplate, SynthScope } from "../types.js";

// Spec 9 §5.1 (responds to S9-P1-2): local-timezone YYYY-MM-DD.
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Spec 9 §5.1 (responds to S9-P0-1): the LLM emits "## <section title>\n<body>";
// split on H2 headers.
export function parseSections(answer: string): { title: string; body: string }[] {
  const parts = answer.split(/^##\s+/m).filter((s) => s.trim());
  return parts.map((p) => {
    const nl = p.indexOf("\n");
    return nl === -1
      ? { title: p.trim(), body: "" }
      : { title: p.slice(0, nl).trim(), body: p.slice(nl + 1).trim() };
  });
}

export const dailyReportIntent: IntentTemplate = {
  id: "daily_report",
  format: "sections", // Spec 7 §3.4
  staleDays: 0, // a daily report is never "stale"
  buildScope: (args): SynthScope => {
    const day = (args.date as string) ?? today();
    // limit:200 is only a retrieval cap; context.ts truncates to a token budget (§6).
    return { time: { from: `${day}T00:00:00`, to: `${day}T23:59:59` }, limit: 200 };
  },
  // Spec 9 §5.1 (responds to R2-S9-P1-1): must be a real string. The 7 H2 titles
  // are fixed and in fixed order; parseSections depends on them.
  systemPrompt:
    "你是用户的工作日报助手。基于下列带编号的今日记忆片段，用中文生成日报。\n" +
    "严格用 7 个二级标题分段，标题文字必须与下列完全一致、顺序不变：\n" +
    "## 今日概览\n## 今日完成\n## 推进中\n## 我的待办\n## 待回复与被@\n## 人脉动态\n## 明日提醒\n" +
    "每段下写要点；事实性条目后用 [n] 标注来源编号；无内容的段写「无」。不要编造未提供的信息。",
  expects: ["今日完成", "我的待办", "明日提醒"], // substrings of the fixed titles above
  gapRules: [missingFieldRule],
  parseSections,
};
