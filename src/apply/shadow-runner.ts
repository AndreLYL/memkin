// src/apply/shadow-runner.ts
//
// Shadow runner (extraction-quality-redesign PR-6, spec §3.1, §11).
//
// Takes an EXISTING distilled payload (produced by PR-2, never re-distilled here)
// and runs it through the SINGLE PR-4 apply engine with target=staging:
//   1. build a staging apply_plan — candidate selection reads the STAGING schema
//      (staging candidates ≠ production candidates, spec §3.1 / §7);
//   2. persist the plan under (payload_id, target=staging);
//   3. apply it via the target-agnostic ApplyEngine, which SET LOCAL search_path
//      routes every write into the physically isolated `staging` schema.
//
// Because production search / embedding / consolidator / stats all keep the
// default search_path (public), staging rows can never pollute retrieval. The
// runner additionally proves this per run: it snapshots the production row count
// before and after and reports the delta (`productionLeak`), which MUST be 0.
//
// Acceptance is judged with the PR-1 metrics pipeline: `shadowAcceptanceReport`
// folds tune/holdout EvaluationResults + the legacy baseline into the same
// AcceptanceReport used everywhere else — holdout carries the only pass/fail
// verdict (directional: noise dropped ≥80% without a miss regression), tune is
// descriptive-only (spec §10, R3 收紧-2).

import {
  type AcceptanceReport,
  type BaselineMetrics,
  type EvaluationResult,
  report,
} from "../eval/metrics.js";
import { DistilledPayloadStore } from "../store/distilled-payload.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import {
  ApplyPlanStore,
  buildApplyPlan,
  type CandidateDecider,
  type CandidateRepository,
  SchemaCandidateRepository,
  type StoredApplyPlan,
} from "./candidate-selection.js";
import { ApplyEngine, type ApplyOutcome } from "./engine.js";

/** Production data tables whose row counts must not move during a shadow run. */
const PRODUCTION_ISOLATION_TABLES = ["public.pages", "public.memory_contributions"] as const;

export interface ShadowRunnerDeps {
  executor: SqlExecutor;
  /** Decides the restricted upsert action per signal (LLM seam; mockable). */
  decider: CandidateDecider;
  /** Override the staging candidate repository (defaults to the staging schema). */
  repo?: CandidateRepository;
  candidateLimit?: number;
}

export interface ShadowRunOutcome {
  payloadId: number;
  /** The persisted staging apply_plan id. */
  planId: number;
  /** The apply engine result (target is always "staging"). */
  apply: ApplyOutcome;
  /**
   * Net production rows written during this shadow run across the isolation
   * tables. MUST be 0 — a non-zero value means the physical isolation leaked.
   */
  productionLeak: number;
}

export class ShadowRunner {
  private readonly payloads: DistilledPayloadStore;
  private readonly plans: ApplyPlanStore;
  private readonly engine: ApplyEngine;

  constructor(private readonly deps: ShadowRunnerDeps) {
    this.payloads = new DistilledPayloadStore(deps.executor);
    this.plans = new ApplyPlanStore(deps.executor);
    this.engine = new ApplyEngine(deps.executor);
  }

  /** Shadow-apply one existing payload to staging and report production leakage. */
  async run(payloadId: number): Promise<ShadowRunOutcome> {
    const payload = await this.payloads.getById(payloadId);
    if (!payload) throw new Error(`shadow run: payload ${payloadId} not found`);

    const before = await this.countProductionRows();

    const repo = this.deps.repo ?? new SchemaCandidateRepository(this.deps.executor, "staging");
    const planData = await buildApplyPlan({
      payload,
      target: "staging",
      repo,
      decider: this.deps.decider,
      candidateLimit: this.deps.candidateLimit,
    });
    const planId = await this.plans.save(planData);
    const plan: StoredApplyPlan = {
      id: planId,
      payloadId,
      target: "staging",
      data: planData,
    };

    const apply = await this.engine.apply(plan);

    const after = await this.countProductionRows();
    return { payloadId, planId, apply, productionLeak: after - before };
  }

  /** Total rows across the production isolation tables (the pollution probe). */
  private async countProductionRows(): Promise<number> {
    let total = 0;
    for (const table of PRODUCTION_ISOLATION_TABLES) {
      const r = await this.deps.executor.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM ${table}`,
      );
      total += r.rows[0]?.n ?? 0;
    }
    return total;
  }
}

/**
 * Build the shadow acceptance report from PR-1 evaluation results (spec §10).
 * Thin adapter over `report()` so the shadow verdict uses the identical metric
 * machinery as everything else: holdout is the only split that passes/fails, and
 * the conclusion is directional given the small holdout size.
 */
export function shadowAcceptanceReport(params: {
  tune: EvaluationResult;
  holdout: EvaluationResult;
  baseline: BaselineMetrics;
}): AcceptanceReport {
  return report(
    { missRate: params.tune.missRate, noiseRate: params.tune.noiseRate },
    { missRate: params.holdout.missRate, noiseRate: params.holdout.noiseRate },
    params.baseline,
  );
}
