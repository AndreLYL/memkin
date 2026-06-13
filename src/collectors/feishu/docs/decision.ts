import { evaluateTriggers } from "./triggers.js";
import type {
  BodyCheckDecision,
  Decision,
  DocCandidate,
  DocCard,
  DocDecisionConfig,
} from "./types.js";

/**
 * Pure decision for a candidate given the existing card (if any).
 * Mirrors the spec's "Full decision flow". The one IO-dependent branch
 * (existing FullCard whose body may have changed) returns `needs_body_check`;
 * Plan 2 fetches raw_content, hashes it, and calls `decideAfterBodyCheck`.
 */
export function decide(
  candidate: DocCandidate,
  existing: DocCard | null,
  config: DocDecisionConfig,
  selfOpenId: string,
  nowMs: number,
): Decision {
  // Gate phase 1
  if (candidate.doc_type !== "docx") {
    return { action: "save_pointer", reason: "non_docx" };
  }

  const trigger = evaluateTriggers(candidate, config, selfOpenId, nowMs);

  if (existing === null) {
    return trigger
      ? { action: "queue_for_upgrade", trigger }
      : { action: "save_pointer", reason: "no_trigger" };
  }

  const modifiedChanged = candidate.modified_at !== existing.modified_at;

  if (existing.extract_level === "pointer") {
    if (!modifiedChanged) {
      return trigger ? { action: "queue_for_upgrade", trigger } : { action: "skip_save" };
    }
    return trigger
      ? { action: "queue_for_upgrade", trigger }
      : { action: "save_pointer", reason: "metadata_refresh" };
  }

  // existing FullCard
  if (!modifiedChanged) {
    return { action: "skip_save" };
  }
  return { action: "needs_body_check" };
}

/**
 * Second-phase decision once raw_content has been fetched and hashed.
 * T5: re-summarize only when the body text actually changed.
 */
export function decideAfterBodyCheck(newBodyHash: string, existingBodyHash: string): BodyCheckDecision {
  return newBodyHash === existingBodyHash
    ? { action: "metadata_refresh" }
    : { action: "queue_for_upgrade", trigger: "T5" };
}
