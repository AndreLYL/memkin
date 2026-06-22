/**
 * Behavior layer (Spec 8 §4.1) — pure functions, zero LLM.
 *
 * `computeContribution(block, opts)` turns a single conversation block into
 * per-person incremental counters (keyed by the OTHER person's canonical slug).
 * `deriveProfile(row)` turns stored counters into a usable view.
 *
 * Direction handling does NOT depend on Spec 9's isMe()/entities/me:
 *  - DM: read the `direction` field already set at collection time (sources/dm.ts).
 *        The other person's messages are those with direction === "received";
 *        response latency is measured for received → sent adjacent pairs.
 *  - Group: no direction. "initiated" = the sender of the block's FIRST message;
 *           everyone else's messages count as replies.
 */

import type { ConversationBlock, RawMessage } from "../core/types.js";
import type { BehaviorContribution, BehaviorProfile, PersonBehaviorRow } from "./types.js";

export interface ComputeOpts {
  /** Map a message's `contact` (sender id) to its canonical person slug. */
  resolveSender: (contact: string) => string;
  /** Treat the block as a group conversation (use first-sender = initiator). */
  isGroup?: boolean;
}

const AT_RE = /@/g;

function emptyContribution(slug: string): BehaviorContribution {
  return {
    person_slug: slug,
    msg_count: 0,
    sum_msg_chars: 0,
    initiated_count: 0,
    reply_count: 0,
    resp_latency_n: 0,
    resp_latency_sum_s: 0,
    hour_histogram: new Array(24).fill(0),
    at_count: 0,
  };
}

function hourOf(ts: string): number {
  const d = new Date(ts);
  const h = d.getUTCHours();
  return Number.isNaN(h) ? 0 : h;
}

function countAts(content: string): number {
  const m = content.match(AT_RE);
  return m ? m.length : 0;
}

/**
 * Compute per-person behavior contributions from one conversation block.
 * Returns a Map keyed by canonical person slug (only the OTHER party, never self).
 */
export function computeContribution(
  block: ConversationBlock,
  opts: ComputeOpts,
): Map<string, BehaviorContribution> {
  const out = new Map<string, BehaviorContribution>();
  const sorted = [...block.messages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const get = (slug: string): BehaviorContribution => {
    let c = out.get(slug);
    if (!c) {
      c = emptyContribution(slug);
      out.set(slug, c);
    }
    return c;
  };

  if (opts.isGroup) {
    const firstSender = sorted[0]?.contact;
    let firstAttributed = false;
    for (const m of sorted) {
      const slug = opts.resolveSender(m.contact);
      const c = get(slug);
      accumulateBasics(c, m);
      if (!firstAttributed && m.contact === firstSender) {
        c.initiated_count += 1;
        firstAttributed = true;
      } else {
        c.reply_count += 1;
      }
    }
    return out;
  }

  // DM: only the other party (direction === "received") gets a contribution.
  // Response latency = their message → our next sent message.
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.direction === "sent") continue; // our own messages don't profile us
    const slug = opts.resolveSender(m.contact);
    const c = get(slug);
    accumulateBasics(c, m);

    // find the next sent message after this received one (adjacent reply by us)
    const next = sorted[i + 1];
    if (next && next.direction === "sent") {
      const latency = (new Date(next.timestamp).getTime() - new Date(m.timestamp).getTime()) / 1000;
      if (latency >= 0) {
        c.resp_latency_n += 1;
        c.resp_latency_sum_s += Math.round(latency);
      }
    }
  }
  return out;
}

function accumulateBasics(c: BehaviorContribution, m: RawMessage): void {
  c.msg_count += 1;
  c.sum_msg_chars += m.content.length;
  c.hour_histogram[hourOf(m.timestamp)] += 1;
  c.at_count += countAts(m.content);
}

/** Derive a usable BehaviorProfile view from stored counters. */
export function deriveProfile(row: PersonBehaviorRow): BehaviorProfile {
  const denom = row.initiated_count + row.reply_count;
  return {
    person_slug: row.person_slug,
    avg_msg_chars: row.msg_count > 0 ? row.sum_msg_chars / row.msg_count : 0,
    initiation_ratio: denom > 0 ? row.initiated_count / denom : 0,
    avg_response_sec: row.resp_latency_n > 0 ? row.resp_latency_sum_s / row.resp_latency_n : null,
    peak_hours: topHours(row.hour_histogram, 3),
    at_per_msg: row.msg_count > 0 ? row.at_count / row.msg_count : 0,
    sample_size: row.msg_count,
  };
}

/** Return the indices of the top-k hours by count (descending), excluding zero-count hours. */
function topHours(hist: number[], k: number): number[] {
  return hist
    .map((count, hour) => ({ count, hour }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, k)
    .map((e) => e.hour);
}
