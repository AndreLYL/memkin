/**
 * Nightly profile synthesis (Spec 8 §7) — the trait + relation layers.
 *
 * This is a SEPARATE structured LLM path, NOT the Spec 7 synthesize() engine.
 * synthesize() produces narrative answers for humans; this produces a structured
 * TraitLayer/RelationLayer object stored into the person page's frontmatter.profile
 * so person_strategy can later inject it via buildPinnedContext.
 *
 * Modeled on consolidator/infer-preferences.ts: iterate type=person pages, read
 * the behavior layer + backlinks + timeline, ask the LLM (responseFormat:"json")
 * for the trait + relation layers, combine the deterministic four-color shell,
 * and write frontmatter.profile. Insufficient samples skip the LLM entirely.
 */

import { createHash } from "node:crypto";
import type { ProfileConfig } from "../core/config.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { PersonBehaviorStore } from "../store/person-behavior.js";
import type { TimelineStore } from "../store/timeline.js";
import { isPersonProfilable } from "./accumulate.js";
import { deriveProfile } from "./behavior.js";
import { toFourColor } from "./four-color.js";
import type { BehaviorProfile, ProfileObject, RelationLayer, TraitLayer } from "./types.js";

export interface ProfileSynthStores {
  pages: PageStore;
  graph: GraphStore;
  timeline: TimelineStore;
  behavior: PersonBehaviorStore;
}

const SYSTEM_PROMPT = [
  "你从用户与某人的客观互动行为统计、共享历史信号（带 slug）里，推断该人的「行为四象限」(D/I/S/C：支配/影响/稳健/谨慎) 特质层与关系层。",
  "方法论硬约束：行为统计是垫底证据，每个维度必须给出 evidence_refs（引用提供的信号 slug）与 confidence；不得脱离证据编造性格判断；证据不足就不给该维度。",
  "对外是「行为四象限」通俗映射，不是临床诊断，不使用 DiSC 商标。",
  '只输出 JSON：{"trait":{"dimensions":[{"axis":"D|I|S|C","level":"low|medium|high","confidence":"low|medium|high","evidence_count":n,"evidence_refs":["slug"],"note":"一句话"}],"insufficient":false},"relation":{"tone":"...","concerns":["..."],"landmines":["..."],"evidence_refs":["slug"]}}',
].join("\n");

function emptyRelation(): RelationLayer {
  return { tone: "", concerns: [], landmines: [], evidence_refs: [] };
}

function insufficientProfile(): { trait: TraitLayer; relation: RelationLayer } {
  return {
    trait: { dimensions: [], insufficient: true },
    relation: emptyRelation(),
  };
}

function renderBehaviorSummary(bp: BehaviorProfile): string {
  return [
    `平均消息长度: ${bp.avg_msg_chars.toFixed(1)} 字`,
    `主动发起比例: ${(bp.initiation_ratio * 100).toFixed(0)}%`,
    `平均回复时延: ${bp.avg_response_sec === null ? "无样本" : `${bp.avg_response_sec.toFixed(0)} 秒`}`,
    `活跃时段(小时): ${bp.peak_hours.join(", ") || "无"}`,
    `@频率: ${bp.at_per_msg.toFixed(2)}/条`,
    `样本量: ${bp.sample_size} 条`,
  ].join("\n");
}

function computeInputHash(personSlug: string, sampleSize: number, evidenceSlugs: string[]): string {
  const key = `${personSlug}|${sampleSize}|${[...evidenceSlugs].sort().join(",")}`;
  return createHash("sha256").update(key).digest("hex");
}

interface LLMTrait {
  trait?: Partial<TraitLayer>;
  relation?: Partial<RelationLayer>;
}

/**
 * Write the structured profile into the page's frontmatter.profile WITHOUT
 * bumping updated_at or re-chunking (nightly synthesis must not pollute recency).
 */
async function writeProfile(pages: PageStore, slug: string, profile: ProfileObject): Promise<void> {
  await pages.patchFrontmatter(slug, { profile });
}

export async function synthesizeProfiles(
  stores: ProfileSynthStores,
  llm: LLMProvider,
  config: ProfileConfig,
): Promise<number> {
  if (!config.enabled) return 0;

  const personPages = await stores.pages.listPages({ type: "person" });
  let written = 0;

  for (const person of personPages) {
    if (!isPersonProfilable(person.slug, config)) continue;

    const row = await stores.behavior.get(person.slug);
    if (!row) continue; // no behavior data → nothing to profile

    const bp = deriveProfile(row);
    const nowIso = new Date().toISOString();

    // Insufficient sample → honest "信息不足", no LLM call, no forced profile.
    if (bp.sample_size < config.min_sample_size) {
      const { trait, relation } = insufficientProfile();
      const profile: ProfileObject = {
        trait,
        relation,
        four_color: toFourColor(trait),
        generated_at: nowIso,
        input_hash: computeInputHash(person.slug, bp.sample_size, []),
        sample_size: bp.sample_size,
      };
      await writeProfile(stores.pages, person.slug, profile);
      written++;
      continue;
    }

    // Gather shared-history evidence (backlinked signals + timeline).
    const backlinks = await stores.graph.getBacklinks(person.slug);
    const evidenceSlugs = backlinks.map((b) => b.from_slug).filter(Boolean);

    // Skip re-synthesis when the evidence is unchanged (avoids redundant LLM calls).
    const newHash = computeInputHash(person.slug, bp.sample_size, evidenceSlugs);
    const existing = person.frontmatter.profile as { input_hash?: string } | undefined;
    if (existing?.input_hash === newHash) continue; // no LLM, no write

    const timeline = await stores.timeline.getTimeline(person.slug);
    const timelineSummary = timeline
      .slice(0, 50)
      .map((e) => `[${e.date}] ${e.summary}`)
      .join("\n");
    const evidenceList = backlinks
      .slice(0, 50)
      .map((b) => `- ${b.from_slug} (${b.link_type}): ${b.context ?? ""}`)
      .join("\n");

    let raw: string;
    try {
      raw = await llm.chat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `人物: ${person.title} (${person.slug})`,
              "",
              "行为统计 (客观，垫底证据):",
              renderBehaviorSummary(bp),
              "",
              "可引用信号 (evidence_refs 用这些 slug):",
              evidenceList || "(无)",
              "",
              "时间线:",
              timelineSummary || "(无)",
            ].join("\n"),
          },
        ],
        { responseFormat: "json" },
      );
    } catch {
      continue; // LLM failure → leave existing profile untouched (graceful degrade)
    }

    let parsed: LLMTrait;
    try {
      parsed = JSON.parse(raw.trim()) as LLMTrait;
    } catch {
      continue; // non-JSON → skip
    }

    // Validate LLM output against the schema and enforce evidence grounding:
    // only dimensions with a valid axis/level survive, and every cited slug must
    // exist in the gathered evidence set (drop hallucinated refs).
    const evidenceSet = new Set(evidenceSlugs);
    const rawDims = Array.isArray(parsed.trait?.dimensions) ? parsed.trait.dimensions : [];
    const validDims = rawDims
      .filter(
        (d) =>
          d &&
          (["D", "I", "S", "C"] as const).includes(d.axis) &&
          (["low", "medium", "high"] as const).includes(d.level),
      )
      .map((d) => {
        const refs = Array.isArray(d.evidence_refs)
          ? d.evidence_refs.filter((s) => evidenceSet.has(s))
          : [];
        return { ...d, evidence_refs: refs, evidence_count: refs.length };
      });

    const trait: TraitLayer = {
      dimensions: validDims,
      big_five: parsed.trait?.big_five,
      insufficient: parsed.trait?.insufficient === true,
    };
    // If the LLM declares insufficient, enforce empty dimensions.
    if (trait.insufficient) trait.dimensions = [];

    const relation: RelationLayer = {
      tone: parsed.relation?.tone ?? "",
      concerns: Array.isArray(parsed.relation?.concerns) ? parsed.relation.concerns : [],
      landmines: Array.isArray(parsed.relation?.landmines) ? parsed.relation.landmines : [],
      evidence_refs: Array.isArray(parsed.relation?.evidence_refs)
        ? parsed.relation.evidence_refs.filter((s) => evidenceSet.has(s))
        : [],
    };

    const profile: ProfileObject = {
      trait,
      relation,
      four_color: toFourColor(trait),
      generated_at: nowIso,
      input_hash: newHash,
      sample_size: bp.sample_size,
    };
    await writeProfile(stores.pages, person.slug, profile);
    written++;
  }

  return written;
}
