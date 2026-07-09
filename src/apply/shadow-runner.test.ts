// src/apply/shadow-runner.test.ts
//
// Task 6.2 — shadow runner (extraction-quality-redesign PR-6, spec §3.1, §11).
// Applies an EXISTING distilled payload to the isolated staging schema with the
// PR-4 apply engine (target=staging), proves production is untouched (physical
// isolation, zero pollution), and folds PR-1 metrics into an acceptance report.

import { describe, expect, it } from "vitest";
import type { DistilledPayload, DistilledSignal } from "../distiller/contract.js";
import type { EvaluationResult } from "../eval/metrics.js";
import { Database } from "../store/database.js";
import { PageStore } from "../store/pages.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import type { CandidateDecider, CandidateDecision } from "./candidate-selection.js";
import { ShadowRunner, shadowAcceptanceReport } from "./shadow-runner.js";

const SOURCE = "claude-code";
const SESSION = "sess-1";

function fixedDecider(d: CandidateDecision): CandidateDecider {
  return { decide: async () => d };
}

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

function stats(mean: number): { mean: number; variance: number } {
  return { mean, variance: 0 };
}

function evalResult(miss: number, noise: number): EvaluationResult {
  return {
    missRate: stats(miss),
    noiseRate: stats(noise),
    runs: [{ missRate: miss, noiseRate: noise }],
  };
}

describe("ShadowRunner — apply an existing payload to staging", () => {
  it("writes a NEW signal to staging, leaving production physically clean", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await seedPayload(db.executor, [decisionSignal()], 1);
      const runner = new ShadowRunner({
        executor: db.executor,
        decider: fixedDecider({ action: "NEW" }),
      });
      const outcome = await runner.run(payloadId);

      expect(outcome.apply.status).toBe("applied");
      expect(outcome.apply.target).toBe("staging");
      expect(outcome.productionLeak).toBe(0);

      const stg = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM staging.pages WHERE slug = 'decisions/use-postgres'",
      );
      const prod = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.pages WHERE slug = 'decisions/use-postgres'",
      );
      expect(stg.rows[0].n).toBe(1);
      expect(prod.rows[0].n).toBe(0);

      // Candidate pool for the staging plan comes from the staging schema.
      expect(outcome.planId).toBeGreaterThan(0);
    } finally {
      await db.executor.close();
    }
  });

  it("does not perturb an existing production library (zero pollution)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      await pages.putPage(
        "decisions/existing",
        "---\ntitle: Existing\ntype: decision\npipeline: v2\n---\nexisting production page",
      );
      const before = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.pages",
      );

      const payloadId = await seedPayload(db.executor, [decisionSignal()], 2);
      const runner = new ShadowRunner({
        executor: db.executor,
        decider: fixedDecider({ action: "NEW" }),
      });
      const outcome = await runner.run(payloadId);

      const after = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.pages",
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      expect(outcome.productionLeak).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("throws when the payload does not exist", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const runner = new ShadowRunner({
        executor: db.executor,
        decider: fixedDecider({ action: "NEW" }),
      });
      await expect(runner.run(9999)).rejects.toThrow(/payload/i);
    } finally {
      await db.executor.close();
    }
  });
});

describe("shadowAcceptanceReport — PR-1 metrics, holdout directional verdict", () => {
  it("passes on the holdout when noise drops >= 80% without a miss regression", () => {
    const report = shadowAcceptanceReport({
      tune: evalResult(0.1, 0.5),
      holdout: evalResult(0.1, 0.05), // noise 0.5 → 0.05 = 90% drop
      baseline: { missRate: 0.1, noiseRate: 0.5 },
    });
    expect(report.holdout.passed).toBe(true);
    expect(report.holdout.descriptiveOnly).toBe(false);
    // Tune is always descriptive-only (never carries a verdict).
    expect(report.tune.descriptiveOnly).toBe(true);
    expect(report.tune.passed).toBeUndefined();
  });

  it("fails the holdout when the miss rate regresses", () => {
    const report = shadowAcceptanceReport({
      tune: evalResult(0.1, 0.5),
      holdout: evalResult(0.3, 0.05), // noise dropped but miss 0.1 → 0.3
      baseline: { missRate: 0.1, noiseRate: 0.5 },
    });
    expect(report.holdout.passed).toBe(false);
  });
});
