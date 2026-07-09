// src/apply/types.ts
//
// Shared types for the target-agnostic apply engine (spec §3.1, §6.2, §7).

import type { DistilledSignal } from "../distiller/contract.js";

/** The apply engine is target-agnostic; every write path takes one of these. */
export type ApplyTarget = "staging" | "production";

/** Restricted upsert action set (spec §7). */
export type ApplyAction = "NEW" | "UPDATE" | "SUPERSEDE" | "LINK_EXISTING" | "NOOP";

/** Entity page types that are always eligible candidates (identity pages). */
export const ENTITY_PAGE_TYPES = ["person", "project", "organization", "tool", "concept"] as const;

/**
 * Frontmatter marker stamped on every page the v2 apply engine writes. The
 * candidate pool (pre-legacy-cleanup) is limited to v2-pipeline pages + identity
 * entity pages (spec §3.1, §7), and rollback of a freshly created page keys off
 * active contributions — NOT this marker — so it is never blind-deleted.
 */
export const V2_PIPELINE_MARKER = "v2";

/**
 * A candidate memory page offered to the LLM for the restricted upsert decision
 * (spec §7). Body is truncated to ~1k chars; content_hash is the CAS snapshot.
 */
export interface Candidate {
  slug: string;
  title: string;
  body: string;
  updated_at: string | null;
  content_hash: string | null;
  project: string | null;
  /** One-line summary of the page's current active contributions. */
  contributions_summary: string;
}

/** One planned action for one signal, frozen into an apply_plan (spec §6.2). */
export interface PlannedAction {
  signal_index: number;
  signal: DistilledSignal;
  contribution_id: string;
  signal_family_key: string;
  normalized_topic: string;
  action: ApplyAction;
  /** UPDATE / SUPERSEDE / LINK_EXISTING target, or a proposed slug for NEW. */
  target_slug: string | null;
  /** CAS snapshot captured at plan time for UPDATE / SUPERSEDE. */
  target_content_hash: string | null;
  /** The top-5 candidates the decision was made against (audit trail). */
  candidates: Candidate[];
  reason: string;
}

/** The full candidate-selection result, persisted as apply_plan.plan. */
export interface ApplyPlanData {
  payload_id: number;
  target: ApplyTarget;
  actions: PlannedAction[];
}
