// src/apply/cutover.ts
//
// Cutover (extraction-quality-redesign PR-6, spec §3.1, §11).
//
// Promotes an EXISTING distilled payload to production with the SINGLE PR-4 apply
// engine (target=production). The load-bearing rule (spec §3.1, review R3-3):
//
//   The staging plan is NEVER reused for production. Candidate page sets,
//   content_hashes, and slug collisions differ between the staging and public
//   schemas, so cutover ALWAYS rebuilds the production candidate selection from
//   scratch (this step is allowed to call the LLM). The distilled payload itself
//   is NOT re-distilled — only the candidate selection is redone.
//
// Flow per payload:
//   1. buildApplyPlan(target=production) — candidate pool from the PUBLIC schema;
//   2. persist the production apply_plan under (payload_id, target=production);
//   3. apply via the target-agnostic ApplyEngine (one transaction, CAS + retry).
//
// Stop-the-bleeding: cutover is flag-gated (agent_pipeline=new). If an apply
// fails or dead-letters, `recommendLegacyFallback` is set and `fallbackMode` is
// "legacy" so the operator can flip the source flag back to legacy. The same
// applies to a triggered rollback (spec §3.1): `rollback()` undoes the apply via
// the PR-4 contributions-based ApplyRollback and returns fallbackMode "legacy".

import type { AgentPipelineMode } from "../core/config.js";
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
import { ApplyRollback, type RollbackOutcome } from "./rollback.js";

/** The mode an operator flips back to when a cutover apply/rollback fires. */
const LEGACY_FALLBACK_MODE: AgentPipelineMode = "legacy";

export interface CutoverDeps {
  executor: SqlExecutor;
  /** Decides the restricted upsert action per signal (LLM seam; mockable). */
  decider: CandidateDecider;
  /** Override the production candidate repository (defaults to the public schema). */
  repo?: CandidateRepository;
  candidateLimit?: number;
}

export interface CutoverOutcome {
  payloadId: number;
  /** The persisted production apply_plan id (freshly regenerated, not the staging one). */
  planId: number;
  /** The apply engine result (target is always "production"). */
  apply: ApplyOutcome;
  /** True when the apply failed / dead-lettered → flip the source flag to legacy. */
  recommendLegacyFallback: boolean;
  /** The mode to flip back to when recommendLegacyFallback is set. */
  fallbackMode: AgentPipelineMode;
}

export interface CutoverRollbackOutcome {
  rollback: RollbackOutcome;
  /** After a rollback, the source flag should return to legacy to stop the bleeding. */
  fallbackMode: AgentPipelineMode;
}

export class Cutover {
  private readonly payloads: DistilledPayloadStore;
  private readonly plans: ApplyPlanStore;
  private readonly engine: ApplyEngine;
  private readonly rollbacker: ApplyRollback;

  constructor(private readonly deps: CutoverDeps) {
    this.payloads = new DistilledPayloadStore(deps.executor);
    this.plans = new ApplyPlanStore(deps.executor);
    this.engine = new ApplyEngine(deps.executor);
    this.rollbacker = new ApplyRollback(deps.executor);
  }

  /** Regenerate the production plan for one existing payload and apply it. */
  async run(payloadId: number): Promise<CutoverOutcome> {
    const payload = await this.payloads.getById(payloadId);
    if (!payload) throw new Error(`cutover: payload ${payloadId} not found`);

    // Rebuild the production candidate selection from scratch — never reuse the
    // staging plan (candidate pools differ per target, spec §3.1). This does NOT
    // re-distill: it only re-decides candidates against the production schema.
    const repo = this.deps.repo ?? new SchemaCandidateRepository(this.deps.executor, "production");
    const planData = await buildApplyPlan({
      payload,
      target: "production",
      repo,
      decider: this.deps.decider,
      candidateLimit: this.deps.candidateLimit,
    });
    const planId = await this.plans.save(planData);
    const plan: StoredApplyPlan = {
      id: planId,
      payloadId,
      target: "production",
      data: planData,
    };

    const apply = await this.engine.apply(plan);
    const recommendLegacyFallback = apply.status !== "applied";
    return {
      payloadId,
      planId,
      apply,
      recommendLegacyFallback,
      fallbackMode: LEGACY_FALLBACK_MODE,
    };
  }

  /**
   * Roll back a cutover apply via the PR-4 contributions-based rollback and
   * signal that the source flag should return to legacy (spec §3.1).
   */
  async rollback(attemptId: number): Promise<CutoverRollbackOutcome> {
    const rollback = await this.rollbacker.rollback(attemptId);
    return { rollback, fallbackMode: LEGACY_FALLBACK_MODE };
  }
}
