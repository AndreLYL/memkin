import { staleRule } from "../gaps.js";
import type { IntentTemplate } from "../types.js";

/**
 * Reference intent shipped by Spec 7 (appendix A).
 * A general "recall" over an entity / free query / time window, producing a single
 * concise synthesized answer with inline [n] citations and a stale gap check.
 */
export const recallIntent: IntentTemplate = {
  id: "recall",
  format: "single",
  staleDays: 14,
  buildScope: (args) => ({
    entity: args.entity as string | undefined,
    query: args.query as string | undefined,
    time: args.time as { from: string; to: string } | undefined,
    limit: 30,
  }),
  systemPrompt: [
    "你是用户的工作记忆助手。下面是带编号的记忆片段。",
    "请用中文写一段简洁、客观的综合回答，概括用户所问范围的情况。",
    "每个事实性断言后用 [n] 标注来源编号（n 对应片段编号）。",
    "只使用提供的片段，不要编造未提供的信息；信息不足时直说。",
  ].join("\n"),
  expects: [],
  gapRules: [staleRule],
};
