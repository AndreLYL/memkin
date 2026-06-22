/**
 * Person communication profile — type definitions (Spec 8 §4).
 *
 * Three layers:
 *  - Behavior layer (objective, zero-LLM): incremental, mergeable counters
 *    persisted to `person_behavior`, keyed by the OTHER person's canonical slug.
 *  - Trait layer (inferred behaviour-quadrant D/I/S/C with evidence + confidence).
 *  - Relation layer (the bespoke you-and-them relationship summary).
 */

/** A single conversation block's incremental contribution, additively merged into the table. */
export interface BehaviorContribution {
  person_slug: string;
  msg_count: number;
  sum_msg_chars: number;
  initiated_count: number;
  reply_count: number;
  resp_latency_n: number;
  resp_latency_sum_s: number;
  hour_histogram: number[]; // length 24
  at_count: number;
}

/** A row read back from `person_behavior` (raw stored counters). */
export interface PersonBehaviorRow {
  person_slug: string;
  msg_count: number;
  sum_msg_chars: number;
  initiated_count: number;
  reply_count: number;
  resp_latency_n: number;
  resp_latency_sum_s: number;
  hour_histogram: number[]; // length 24
  at_count: number;
  window_start: string | null;
  updated_at: string;
}

/** Derived, usable view computed on read from a PersonBehaviorRow. */
export interface BehaviorProfile {
  person_slug: string;
  avg_msg_chars: number;
  initiation_ratio: number; // initiated/(initiated+reply); 0 when both are 0
  avg_response_sec: number | null; // null when resp_latency_n === 0
  peak_hours: number[]; // top-3 active hours from histogram
  at_per_msg: number;
  sample_size: number; // = msg_count, drives confidence
}

export type Axis = "D" | "I" | "S" | "C"; // 支配/影响/稳健/谨慎
export type Level = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";

export interface TraitDimension {
  axis: Axis;
  level: Level;
  confidence: Confidence;
  evidence_count: number;
  evidence_refs: string[]; // supporting signal slugs (Spec 7 Citation backlinks)
  note: string; // one-line explanation
}

export interface TraitLayer {
  /** 4 dimensions (D/I/S/C) when sufficient; empty [] when insufficient. */
  dimensions: TraitDimension[];
  big_five?: Record<string, number>; // optional cross-check, 0-100
  insufficient: boolean; // not enough evidence → true, do not force a profile
}

export interface RelationLayer {
  tone: string; // relationship baseline (合作顺畅 / 有摩擦 / 上下级 ...)
  concerns: string[]; // things the other person repeatedly cares about
  landmines: string[]; // taboos / things to avoid
  evidence_refs: string[];
}

/** Four-color shell (通俗映射，非临床诊断). */
export interface FourColor {
  colors: string[]; // e.g. ["🔴 红"] or ["🔴 红", "🔵 蓝"]
  descriptions: string[];
  disclaimer: string; // always "通俗映射，非临床诊断"
}

/** The structured profile cached into a person page's frontmatter.profile. */
export interface ProfileObject {
  trait: TraitLayer;
  relation: RelationLayer;
  four_color: FourColor;
  generated_at: string;
  input_hash: string;
  sample_size: number;
}
