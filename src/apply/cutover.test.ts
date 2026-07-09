// src/apply/cutover.test.ts
//
// Task 6.3 — cutover (extraction-quality-redesign PR-6, spec §3.1, §11).
// Regenerates the PRODUCTION candidate selection for an existing payload (the
// staging plan is NEVER reused — candidate pools differ per target), persists a
// production apply_plan, and applies it in one transaction. The distilled
// payload is NOT re-distilled. A failed/dead-lettered apply recommends flipping
// the source flag back to legacy to stop the bleeding.

import { describe, expect, it } from "vitest";
import type { DistilledPayload, DistilledSignal } from "../distiller/contract.js";
import { Database } from "../store/database.js";
import { PageStore } from "../store/pages.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import {
  ApplyPlanStore,
  type CandidateDecider,
  type CandidateDecision,
  type CandidateRepository,
} from "./candidate-selection.js";
import { Cutover } from "./cutover.js";
import type { Candidate } from "./types.js";

const SOURCE = "claude-code";
const SESSION = "sess-1";

function decisionSignal(over: Partial<DistilledSignal> = {}): DistilledSignal {
  return {
    type: "decision",
    topic: "Use Postgres",
    what: "Adopt Postgres as the store",
    why: "durability",
    entities: [],
    authority: "user_confirmed",
    evidence: [{ start: "m1", end: "m2" }],
    persistence_reason: "architecture decision",
    ...over,
  } as DistilledSignal;
}

function fixedDecider(d: CandidateDecision): CandidateDecider {
  return { decide: async () => d };
}

async function seedPayload(
  ex: SqlExecutor,
  signals: DistilledSignal[],
  revisionId: number,
): Promise<number> {
  const payload: DistilledPayload = { signals };
  const r = await ex.query<{ id: number }>(
    `INSERT INTO distilled_payload (source_instance, session_id, revision_id, content_hash, payload)
     VALUES ($1, $2, $3, 'h', $4::jsonb) RETURNING id`,
    [SOURCE, SESSION, revisionId, JSON.stringify(payload)],
  );
  return r.rows[0].id;
}

describe("Cutover — regenerate the production plan and apply", () => {
  it("applies to production (not staging) for a fresh payload", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await seedPayload(db.executor, [decisionSignal()], 1);
      const outcome = await new Cutover({
        executor: db.executor,
        decider: fixedDecider({ action: "NEW" }),
      }).run(payloadId);

      expect(outcome.apply.status).toBe("applied");
      expect(outcome.apply.target).toBe("production");
      expect(outcome.recommendLegacyFallback).toBe(false);

      const prod = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.pages WHERE slug = 'decisions/use-postgres'",
      );
      const stg = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM staging.pages WHERE slug = 'decisions/use-postgres'",
      );
      expect(prod.rows[0].n).toBe(1);
      expect(stg.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("re-runs candidate selection instead of reusing a pre-existing staging plan", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await seedPayload(db.executor, [decisionSignal()], 2);
      const plans = new ApplyPlanStore(db.executor);
      // A staging plan already exists for this payload (from a prior shadow run).
      const stagingPlanId = await plans.save({
        payload_id: payloadId,
        target: "staging",
        actions: [],
      });

      let deciderCalls = 0;
      const decider: CandidateDecider = {
        decide: async () => {
          deciderCalls++;
          return { action: "NEW" };
        },
      };
      const outcome = await new Cutover({ executor: db.executor, decider }).run(payloadId);

      // The decider ran → candidate selection was regenerated, not reused.
      expect(deciderCalls).toBe(1);
      // A distinct production plan row was persisted.
      const prodPlan = await plans.getByPayloadTarget(payloadId, "production");
      expect(prodPlan).not.toBeNull();
      expect(prodPlan?.id).not.toBe(stagingPlanId);
      expect(outcome.planId).toBe(prodPlan?.id);
    } finally {
      await db.executor.close();
    }
  });

  it("does not re-distill: no new distilled_payload row is created", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await seedPayload(db.executor, [decisionSignal()], 3);
      const before = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM distilled_payload",
      );
      await new Cutover({
        executor: db.executor,
        decider: fixedDecider({ action: "NEW" }),
      }).run(payloadId);
      const after = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM distilled_payload",
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      await db.executor.close();
    }
  });

  it("recommends legacy fallback and writes nothing when apply dead-letters (CAS)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      await pages.putPage(
        "decisions/use-postgres",
        "---\ntitle: Use Postgres\ntype: decision\npipeline: v2\n---\ncurrent body",
      );
      const payloadId = await seedPayload(db.executor, [decisionSignal()], 4);

      // Repo hands back a candidate whose content_hash is stale → CAS mismatch.
      const staleCandidate: Candidate = {
        slug: "decisions/use-postgres",
        title: "Use Postgres",
        body: "current body",
        updated_at: null,
        content_hash: "STALE-HASH-NEVER-MATCHES",
        project: null,
        contributions_summary: "",
      };
      const repo: CandidateRepository = { findCandidates: async () => [staleCandidate] };

      const outcome = await new Cutover({
        executor: db.executor,
        decider: fixedDecider({ action: "UPDATE", target_slug: "decisions/use-postgres" }),
        repo,
      }).run(payloadId);

      expect(outcome.apply.status).toBe("dead_letter");
      expect(outcome.recommendLegacyFallback).toBe(true);
      expect(outcome.fallbackMode).toBe("legacy");

      // No contribution committed (transaction rolled back).
      const contribs = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.memory_contributions",
      );
      expect(contribs.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("rollback deactivates the applied contributions and flags legacy fallback", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await seedPayload(db.executor, [decisionSignal()], 5);
      const cutover = new Cutover({
        executor: db.executor,
        decider: fixedDecider({ action: "NEW" }),
      });
      const outcome = await cutover.run(payloadId);
      expect(outcome.apply.status).toBe("applied");

      const rb = await cutover.rollback(outcome.apply.attemptId);
      expect(rb.fallbackMode).toBe("legacy");
      expect(rb.rollback.deactivated).toBeGreaterThan(0);

      const active = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.memory_contributions WHERE active",
      );
      expect(active.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });
});
