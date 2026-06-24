import { MEMOARK_BLOCK_END, MEMOARK_BLOCK_START } from "./directive.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches a single memoark-delimited block (non-greedy, spans newlines).
const blockRegex = new RegExp(
  `${escapeRegExp(MEMOARK_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MEMOARK_BLOCK_END)}`,
);

/**
 * Insert or replace the memoark block in `existing`.
 * `block` must already include the start/end markers (e.g. DIRECTIVE_L1).
 * Idempotent: re-running with changed content replaces in place, never appends a duplicate.
 */
export function upsertBlock(existing: string, block: string): string {
  if (blockRegex.test(existing)) {
    return existing.replace(blockRegex, block);
  }
  if (existing.trim() === "") return `${block}\n`;
  return `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
}

/** Remove the memoark block, tidying surrounding whitespace. No-op if absent. */
export function removeBlock(existing: string): string {
  if (!blockRegex.test(existing)) return existing;
  const tidied = existing
    .replace(blockRegex, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*$/, "");
  return tidied === "" ? "" : `${tidied}\n`;
}

/** True if `existing` already contains a memoark block. */
export function hasBlock(existing: string): boolean {
  return blockRegex.test(existing);
}
