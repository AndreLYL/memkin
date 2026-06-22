/**
 * Pipeline-side behavior accumulation (Spec 8 §4.1 / §9).
 *
 * Gated by config.profile: when disabled, nothing is written. Per-person
 * allow/deny lists (canonical slugs) further gate which people are profiled.
 * Group vs DM is inferred from the block channel ("group/..." → group).
 */

import type { ProfileConfig } from "../core/config.js";
import type { ConversationBlock } from "../core/types.js";
import type { PersonBehaviorStore } from "../store/person-behavior.js";
import { computeContribution } from "./behavior.js";

export interface AccumulateDeps {
  store: PersonBehaviorStore;
  config: ProfileConfig;
  /**
   * Map a message's `contact` (sender id) to its canonical person slug.
   * May be sync or async (e.g. an identity-handle lookup); senders are
   * pre-resolved once per block before the (sync) contribution computation.
   */
  resolveSender: (contact: string) => string | Promise<string>;
}

/** Whether a person (by canonical slug) is allowed to be profiled. */
export function isPersonProfilable(slug: string, config: ProfileConfig): boolean {
  if (config.deny.includes(slug)) return false;
  if (config.allow.length > 0 && !config.allow.includes(slug)) return false;
  return true;
}

function isGroupBlock(block: ConversationBlock): boolean {
  return block.channel.startsWith("group/");
}

/**
 * Accumulate behavior counters for a single conversation block.
 * No-op when profiling is disabled (the pipeline writes 0 rows in that case).
 */
export async function accumulateBehavior(
  block: ConversationBlock,
  deps: AccumulateDeps,
): Promise<void> {
  if (!deps.config.enabled) return;

  // Pre-resolve each unique sender once (resolveSender may be async), then feed a
  // synchronous lookup to computeContribution.
  const resolved = new Map<string, string>();
  for (const m of block.messages) {
    if (!resolved.has(m.contact)) {
      resolved.set(m.contact, await deps.resolveSender(m.contact));
    }
  }

  const contributions = computeContribution(block, {
    resolveSender: (contact) => resolved.get(contact) ?? `people/${contact}`,
    isGroup: isGroupBlock(block),
  });

  for (const [slug, contribution] of contributions) {
    if (!isPersonProfilable(slug, deps.config)) continue;
    if (contribution.msg_count === 0) continue;
    await deps.store.upsertContribution(contribution);
  }
}
