import type { AssembledContext, ComposeOutput, Gap, GapRule, IntentTemplate } from "./types.js";

const DEFAULT_STALE_DAYS = 14;

/**
 * stale gap (Spec 7 §六): the freshest candidate is older than the intent's staleDays threshold.
 * Deterministic; no LLM.
 */
export const staleRule: GapRule = {
  id: "stale",
  evaluate(ctx: AssembledContext, _raw: ComposeOutput, intent: IntentTemplate): Gap[] {
    if (!ctx.latestDate) return [];
    const staleDays = intent.staleDays ?? DEFAULT_STALE_DAYS;
    const ageDays = (Date.now() - new Date(ctx.latestDate).getTime()) / 86_400_000;
    if (ageDays <= staleDays) return [];
    return [
      {
        type: "stale",
        message: `最新信息距今约 ${Math.floor(ageDays)} 天（超过 ${staleDays} 天阈值），可能已过期。`,
        meta: { latestDate: ctx.latestDate, staleDays, ageDays: Math.floor(ageDays) },
      },
    ];
  },
};

/**
 * missing_field gap (Spec 7 §六): an expected point (intent.expects) is not covered by the answer.
 * Deterministic keyword/heuristic match.
 */
export const missingFieldRule: GapRule = {
  id: "missing_field",
  evaluate(_ctx: AssembledContext, raw: ComposeOutput, intent: IntentTemplate): Gap[] {
    const expects = intent.expects ?? [];
    if (expects.length === 0) return [];
    const haystack = raw.answer.toLowerCase();
    const missing = expects.filter((field) => !haystack.includes(field.toLowerCase()));
    if (missing.length === 0) return [];
    return [
      {
        type: "missing_field",
        message: `回答未覆盖以下要点：${missing.join("、")}。`,
        meta: { missing },
      },
    ];
  },
};

/**
 * contradiction gap (Spec 7 §六): placeholder. Default off — runs as an independent optional
 * pass (not mixed into compose). Implemented in a later spec / consolidator follow-up.
 */
export const contradictionRule: GapRule = {
  id: "contradiction",
  evaluate(): Gap[] {
    return [];
  },
};
