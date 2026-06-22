/**
 * person_strategy intent (Spec 8 §6) — the Hero feature's strategy synthesis.
 *
 * Produces practical, evidence-cited communication advice for a person, optionally
 * conditioned on a goal (passed via SynthOpts.extra.goal, threaded by the engine).
 *
 * The structured person profile (frontmatter.profile) is injected as non-citable
 * pinnedContext via the buildPinnedContext hook; the [n] citations still point at
 * candidate signals (the profile's evidence_refs surface there as candidates).
 *
 * Ethics guardrail (§6.3) is the literal systemPrompt: suggestions for better
 * communication/collaboration only — never manipulation, PUA, or pressure tactics.
 */

import type { StoreContext } from "../../server/api.js";
import { staleRule } from "../gaps.js";
import type { IntentTemplate, SynthScope } from "../types.js";

interface ProfileLike {
  trait?: {
    insufficient?: boolean;
    dimensions?: Array<{
      axis?: string;
      level?: string;
      confidence?: string;
      note?: string;
    }>;
  };
  four_color?: { colors?: string[]; descriptions?: string[]; disclaimer?: string };
  relation?: { tone?: string; concerns?: string[]; landmines?: string[] };
}

/** Render a person's structured profile into a compact, non-citable framework block. */
export function renderProfileBlock(profile: ProfileLike): string {
  const lines: string[] = ["【沟通画像（前置参考，非引用来源）】"];

  const trait = profile.trait;
  if (trait?.insufficient) {
    lines.push("特质层：证据不足，暂不画像。");
  } else if (trait?.dimensions && trait.dimensions.length > 0) {
    lines.push("行为四象限：");
    for (const d of trait.dimensions) {
      const parts = [`${d.axis ?? "?"} ${d.level ?? ""}`.trim()];
      if (d.confidence) parts.push(`置信度:${d.confidence}`);
      if (d.note) parts.push(d.note);
      lines.push(`- ${parts.join("，")}`);
    }
  }

  const fc = profile.four_color;
  if (fc?.colors && fc.colors.length > 0) {
    lines.push(`四色：${fc.colors.join(" / ")}（${fc.disclaimer ?? "通俗映射，非临床诊断"}）`);
  }

  const rel = profile.relation;
  if (rel) {
    if (rel.tone) lines.push(`关系基调：${rel.tone}`);
    if (rel.concerns && rel.concerns.length > 0) lines.push(`对方在意：${rel.concerns.join("、")}`);
    if (rel.landmines && rel.landmines.length > 0) lines.push(`雷区：${rel.landmines.join("、")}`);
  }

  return lines.join("\n");
}

export const personStrategyIntent: IntentTemplate = {
  id: "person_strategy",
  format: "single",
  staleDays: 21,
  buildScope: (args) => ({ entity: args.person as string, limit: 40 }),
  systemPrompt:
    "你基于用户与某人的真实互动画像（前置 pinnedContext）和下列带编号的信号，给出实用的沟通建议。\n" +
    "要求：① 只给「如何更好沟通/协作」的建议，不得给操纵、PUA、施压话术；② 尊重对方、假设善意；\n" +
    "③ 每条建议后用 [n] 标注证据；④ 若提供了「本次沟通目标」，针对该目标给策略；⑤ 证据不足直说，不编造性格判断。",
  expects: ["沟通建议"],
  gapRules: [staleRule],
  buildPinnedContext: async (scope: SynthScope, stores: StoreContext) => {
    if (!scope.entity) return undefined;
    const page = await stores.pages.getPage(scope.entity);
    const profile = page?.frontmatter?.profile as ProfileLike | undefined;
    return profile ? renderProfileBlock(profile) : undefined;
  },
};
