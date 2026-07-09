// src/apply/candidate-selection.ts
//
// Restricted upsert candidate selection (spec §7). For each signal in a
// distilled payload this picks one of five actions —
// NEW | UPDATE | SUPERSEDE | LINK_EXISTING | NOOP — against a top-5 candidate
// pool drawn from the CURRENT TARGET's schema (staging candidates ≠ production
// candidates). The result is frozen into an apply_plan(payload_id, target); the
// apply engine later replays that plan WITHOUT calling the LLM again (spec §6.2).
//
// Guardrails:
//   - Authority admissibility (spec §5): session-log-only signals become NOOP
//     and never reach the LLM (no candidate page is created for them).
//   - Candidate pool is restricted (pre-legacy-cleanup) to v2-pipeline pages +
//     identity entity pages (spec §3.1).
//   - Restricted actions (UPDATE/SUPERSEDE/LINK_EXISTING) must reference a slug
//     that is actually in the offered candidate set; an out-of-pool pick is
//     coerced to NEW so the LLM can never point at an arbitrary page.

import { admissibility } from "../distiller/authority-matrix.js";
import type { DistilledSignal } from "../distiller/contract.js";
import type { StoredPayload } from "../store/distilled-payload.js";
import type { SqlConn } from "../store/sql-executor.js";
import { contributionId, normalizeTopic, signalFamilyKey } from "./ids.js";
import {
  type ApplyAction,
  type ApplyPlanData,
  type ApplyTarget,
  type Candidate,
  ENTITY_PAGE_TYPES,
  type PlannedAction,
} from "./types.js";

export const DEFAULT_CANDIDATE_LIMIT = 5;
const BODY_TRUNCATE = 1000;

/** The LLM's decision for one signal against its candidate set. */
export interface CandidateDecision {
  action: ApplyAction;
  target_slug?: string | null;
  reason?: string;
}

/** Pluggable decider — a thin LLM seam so tests can mock it deterministically. */
export interface CandidateDecider {
  decide(input: {
    signal: DistilledSignal;
    candidates: Candidate[];
    target: ApplyTarget;
  }): Promise<CandidateDecision>;
}

/** Source of candidate pages, scoped to one target schema. */
export interface CandidateRepository {
  findCandidates(signal: DistilledSignal, limit: number): Promise<Candidate[]>;
}

function truncate(s: string): string {
  return s.length > BODY_TRUNCATE ? `${s.slice(0, BODY_TRUNCATE)}…` : s;
}

const RESTRICTED_ACTIONS = new Set<ApplyAction>(["UPDATE", "SUPERSEDE", "LINK_EXISTING"]);

/**
 * Read candidate pages from a target schema. Trigram-ranked against the signal's
 * topic + what, restricted to the v2 candidate pool (spec §3.1 / §7).
 */
export class SchemaCandidateRepository implements CandidateRepository {
  private readonly schema: string;

  constructor(
    private readonly pg: SqlConn,
    target: ApplyTarget,
  ) {
    this.schema = target === "staging" ? "staging" : "public";
  }

  async findCandidates(signal: DistilledSignal, limit: number): Promise<Candidate[]> {
    const probe = `${signal.topic} ${signal.what}`.trim();
    const rows = await this.pg.query<{
      slug: string;
      title: string;
      body: string;
      updated_at: string | null;
      content_hash: string | null;
      project: string | null;
      contributions_summary: string | null;
    }>(
      `SELECT p.slug, p.title,
              LEFT(p.compiled_truth, ${BODY_TRUNCATE}) AS body,
              p.updated_at::text AS updated_at,
              p.content_hash,
              p.frontmatter->>'project' AS project,
              (
                SELECT COALESCE(string_agg(mc.signal->>'what', '; '), '')
                FROM ${this.schema}.memory_contributions mc
                WHERE mc.canonical_page_id = p.id AND mc.active
              ) AS contributions_summary
         FROM ${this.schema}.pages p
        WHERE (p.frontmatter->>'pipeline' = 'v2' OR p.type = ANY($2::text[]))
          AND GREATEST(similarity(p.title, $1), similarity(p.compiled_truth, $1)) > 0
        ORDER BY GREATEST(similarity(p.title, $1), similarity(p.compiled_truth, $1)) DESC,
                 p.updated_at DESC
        LIMIT $3`,
      [probe, ENTITY_PAGE_TYPES as unknown as string[], limit],
    );
    return rows.rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      body: truncate(r.body ?? ""),
      updated_at: r.updated_at,
      content_hash: r.content_hash,
      project: r.project,
      contributions_summary: r.contributions_summary ?? "",
    }));
  }
}

/**
 * Build the apply plan for one payload against one target. Pure orchestration —
 * no writes; the returned data is what ApplyPlanStore.save persists.
 */
export async function buildApplyPlan(params: {
  payload: StoredPayload;
  target: ApplyTarget;
  repo: CandidateRepository;
  decider: CandidateDecider;
  candidateLimit?: number;
}): Promise<ApplyPlanData> {
  const { payload, target, repo, decider } = params;
  const limit = params.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const actions: PlannedAction[] = [];

  const signals = payload.payload.signals;
  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    const normalizedTopic = normalizeTopic(signal.topic);
    const cid = contributionId(payload.revisionId, signal.type, normalizedTopic);
    const fam = signalFamilyKey(
      payload.sourceInstance,
      payload.sessionId,
      signal.type,
      normalizedTopic,
    );

    const base = {
      signal_index: i,
      signal,
      contribution_id: cid,
      signal_family_key: fam,
      normalized_topic: normalizedTopic,
    };

    // Authority gate (spec §5): session-log-only signals never create a page.
    if (admissibility(signal.type, signal.authority) === "session_log_only") {
      actions.push({
        ...base,
        action: "NOOP",
        target_slug: null,
        target_content_hash: null,
        candidates: [],
        reason: "session_log_only (authority admissibility)",
      });
      continue;
    }

    const candidates = await repo.findCandidates(signal, limit);
    const decision = await decider.decide({ signal, candidates, target });

    let action = decision.action;
    let targetSlug = decision.target_slug ?? null;
    let reason = decision.reason ?? "";
    let contentHash: string | null = null;

    if (RESTRICTED_ACTIONS.has(action)) {
      const match = candidates.find((c) => c.slug === targetSlug);
      if (!match) {
        // Out-of-pool pick — coerce to NEW rather than trust an arbitrary slug.
        action = "NEW";
        targetSlug = null;
        reason = `${reason} [coerced to NEW: target not in candidate pool]`.trim();
      } else {
        contentHash = match.content_hash;
      }
    } else if (action === "NOOP") {
      targetSlug = null;
    }

    actions.push({
      ...base,
      action,
      target_slug: targetSlug,
      target_content_hash: contentHash,
      candidates,
      reason,
    });
  }

  return { payload_id: payload.id, target, actions };
}

interface PlanRow {
  id: number;
  payload_id: number;
  target: ApplyTarget;
  plan: ApplyPlanData | string;
  created_at: string;
}

export interface StoredApplyPlan {
  id: number;
  payloadId: number;
  target: ApplyTarget;
  data: ApplyPlanData;
}

function parsePlan(row: PlanRow): StoredApplyPlan {
  const data = typeof row.plan === "string" ? (JSON.parse(row.plan) as ApplyPlanData) : row.plan;
  return { id: row.id, payloadId: row.payload_id, target: row.target, data };
}

/** Persists / retrieves frozen apply plans (one per payload+target). */
export class ApplyPlanStore {
  constructor(private readonly pg: SqlConn) {}

  /** Upsert the plan for (payload_id, target); returns the plan id. */
  async save(data: ApplyPlanData): Promise<number> {
    const r = await this.pg.query<{ id: number }>(
      `INSERT INTO apply_plan (payload_id, target, plan)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (payload_id, target) DO UPDATE SET plan = EXCLUDED.plan
       RETURNING id`,
      [data.payload_id, data.target, JSON.stringify(data)],
    );
    return r.rows[0].id;
  }

  async getById(id: number): Promise<StoredApplyPlan | null> {
    const r = await this.pg.query<PlanRow>("SELECT * FROM apply_plan WHERE id = $1", [id]);
    return r.rows[0] ? parsePlan(r.rows[0]) : null;
  }

  async getByPayloadTarget(
    payloadId: number,
    target: ApplyTarget,
  ): Promise<StoredApplyPlan | null> {
    const r = await this.pg.query<PlanRow>(
      "SELECT * FROM apply_plan WHERE payload_id = $1 AND target = $2",
      [payloadId, target],
    );
    return r.rows[0] ? parsePlan(r.rows[0]) : null;
  }
}
