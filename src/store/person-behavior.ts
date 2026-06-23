/**
 * PersonBehaviorStore — persistence for the behavior layer (Spec 8 §4.1).
 *
 * Stores additively-mergeable counters keyed by the OTHER person's canonical
 * slug. Behavior-layer metrics (response latency, message length, active hours,
 * initiation, @-frequency) cannot be recomputed after extraction (raw messages
 * are dropped), so they are accumulated incrementally as the pipeline processes
 * DM / group blocks.
 */

import type { PGlite } from "@electric-sql/pglite";
import type { BehaviorContribution, PersonBehaviorRow } from "../profile/types.js";

interface RawRow {
  person_slug: string;
  msg_count: number;
  sum_msg_chars: number;
  initiated_count: number;
  reply_count: number;
  resp_latency_n: number;
  resp_latency_sum_s: number | string;
  hour_histogram: number[] | string;
  at_count: number;
  window_start: string | null;
  updated_at: string;
}

function toRow(r: RawRow): PersonBehaviorRow {
  const hist =
    typeof r.hour_histogram === "string"
      ? (JSON.parse(r.hour_histogram) as number[])
      : r.hour_histogram;
  return {
    person_slug: r.person_slug,
    msg_count: Number(r.msg_count),
    sum_msg_chars: Number(r.sum_msg_chars),
    initiated_count: Number(r.initiated_count),
    reply_count: Number(r.reply_count),
    resp_latency_n: Number(r.resp_latency_n),
    resp_latency_sum_s: Number(r.resp_latency_sum_s),
    hour_histogram: hist,
    at_count: Number(r.at_count),
    window_start: r.window_start,
    updated_at: r.updated_at,
  };
}

/** Element-wise add two length-24 histograms. */
function addHistograms(a: number[], b: number[]): number[] {
  const out = new Array(24).fill(0);
  for (let i = 0; i < 24; i++) {
    out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  }
  return out;
}

export class PersonBehaviorStore {
  constructor(private pg: PGlite) {}

  /**
   * Additively merge a contribution into the row for `person_slug`.
   * On INSERT, window_start is set to NOW(); on UPDATE it is left unchanged.
   */
  async upsertContribution(c: BehaviorContribution): Promise<void> {
    const existing = await this.get(c.person_slug);
    if (!existing) {
      await this.pg.query(
        `INSERT INTO person_behavior
           (person_slug, msg_count, sum_msg_chars, initiated_count, reply_count,
            resp_latency_n, resp_latency_sum_s, hour_histogram, at_count, window_start, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          c.person_slug,
          c.msg_count,
          c.sum_msg_chars,
          c.initiated_count,
          c.reply_count,
          c.resp_latency_n,
          c.resp_latency_sum_s,
          JSON.stringify(normalizeHist(c.hour_histogram)),
          c.at_count,
        ],
      );
      return;
    }

    const mergedHist = addHistograms(existing.hour_histogram, normalizeHist(c.hour_histogram));
    await this.pg.query(
      `UPDATE person_behavior SET
         msg_count = msg_count + $2,
         sum_msg_chars = sum_msg_chars + $3,
         initiated_count = initiated_count + $4,
         reply_count = reply_count + $5,
         resp_latency_n = resp_latency_n + $6,
         resp_latency_sum_s = resp_latency_sum_s + $7,
         hour_histogram = $8,
         at_count = at_count + $9,
         updated_at = NOW()
       WHERE person_slug = $1`,
      [
        c.person_slug,
        c.msg_count,
        c.sum_msg_chars,
        c.initiated_count,
        c.reply_count,
        c.resp_latency_n,
        c.resp_latency_sum_s,
        JSON.stringify(mergedHist),
        c.at_count,
      ],
    );
  }

  async get(personSlug: string): Promise<PersonBehaviorRow | null> {
    const r = await this.pg.query<RawRow>("SELECT * FROM person_behavior WHERE person_slug = $1", [
      personSlug,
    ]);
    return r.rows.length > 0 ? toRow(r.rows[0]) : null;
  }

  async list(): Promise<PersonBehaviorRow[]> {
    const r = await this.pg.query<RawRow>("SELECT * FROM person_behavior");
    return r.rows.map(toRow);
  }

  /**
   * Merge the `from` person's behavior counters into `into` (additive),
   * then delete the `from` row. Used by person-identity merge.
   */
  async merge(fromSlug: string, intoSlug: string): Promise<void> {
    if (fromSlug === intoSlug) return;
    const from = await this.get(fromSlug);
    if (!from) return;
    await this.upsertContribution({
      person_slug: intoSlug,
      msg_count: from.msg_count,
      sum_msg_chars: from.sum_msg_chars,
      initiated_count: from.initiated_count,
      reply_count: from.reply_count,
      resp_latency_n: from.resp_latency_n,
      resp_latency_sum_s: from.resp_latency_sum_s,
      hour_histogram: from.hour_histogram,
      at_count: from.at_count,
    });
    await this.pg.query("DELETE FROM person_behavior WHERE person_slug = $1", [fromSlug]);
  }
}

function normalizeHist(h: number[]): number[] {
  const out = new Array(24).fill(0);
  for (let i = 0; i < 24; i++) out[i] = h[i] ?? 0;
  return out;
}
