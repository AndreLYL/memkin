import { describe, expect, it } from "vitest";
import type { DistilledPayload, DistilledSignal } from "../distiller/contract.js";
import { Database } from "../store/database.js";
import type { StoredPayload } from "../store/distilled-payload.js";
import { PageStore } from "../store/pages.js";
import {
  ApplyPlanStore,
  buildApplyPlan,
  type CandidateDecider,
  type CandidateDecision,
  type CandidateRepository,
  SchemaCandidateRepository,
} from "./candidate-selection.js";
import { contributionId, normalizeTopic, signalFamilyKey } from "./ids.js";
import type { Candidate } from "./types.js";

function decisionSignal(over: Partial<DistilledSignal> = {}): DistilledSignal {
  return {
    type: "decision",
    topic: "Use Postgres",
    what: "Adopt Postgres as the store",
    entities: [],
    authority: "user_confirmed",
    evidence: [{ start: "msg-1", end: "msg-2" }],
    persistence_reason: "architecture decision",
    ...over,
  } as DistilledSignal;
}

function knowledgeSignal(over: Partial<DistilledSignal> = {}): DistilledSignal {
  return {
    type: "knowledge",
    topic: "PGLite is slow",
    what: "PGLite tests take minutes",
    entities: [],
    authority: "assistant_claimed",
    evidence: [{ start: "msg-3", end: "msg-4" }],
    persistence_reason: "gotcha",
    source_kind: "observation",
    ...over,
  } as DistilledSignal;
}

function storedPayload(
  signals: DistilledSignal[],
  over: Partial<StoredPayload> = {},
): StoredPayload {
  const payload: DistilledPayload = { signals };
  return {
    id: 1,
    sourceInstance: "claude-code",
    sessionId: "sess-1",
    revisionId: 42,
    contentHash: "h",
    payload,
    restorationMap: null,
    ttlExpiresAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const emptyRepo: CandidateRepository = { findCandidates: async () => [] };
function fixedDecider(d: CandidateDecision): CandidateDecider {
  return { decide: async () => d };
}

describe("buildApplyPlan — restricted upsert candidate selection", () => {
  it("maps session-log-only signals to NOOP without consulting the LLM", async () => {
    // decision + assistant_claimed is session-log-only (spec §5).
    let deciderCalled = false;
    const decider: CandidateDecider = {
      decide: async () => {
        deciderCalled = true;
        return { action: "NEW" };
      },
    };
    const payload = storedPayload([decisionSignal({ authority: "assistant_claimed" })]);
    const plan = await buildApplyPlan({ payload, target: "production", repo: emptyRepo, decider });

    expect(deciderCalled).toBe(false);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].action).toBe("NOOP");
    expect(plan.actions[0].reason).toMatch(/session_log_only/);
  });

  it("computes deterministic two-layer IDs per signal", async () => {
    const payload = storedPayload([decisionSignal()]);
    const plan = await buildApplyPlan({
      payload,
      target: "production",
      repo: emptyRepo,
      decider: fixedDecider({ action: "NEW" }),
    });
    const norm = normalizeTopic("Use Postgres");
    expect(plan.actions[0].normalized_topic).toBe(norm);
    expect(plan.actions[0].contribution_id).toBe(contributionId(42, "decision", norm));
    expect(plan.actions[0].signal_family_key).toBe(
      signalFamilyKey("claude-code", "sess-1", "decision", norm),
    );
  });

  it("keeps a valid UPDATE and captures the CAS content_hash from the candidate", async () => {
    const cand: Candidate = {
      slug: "decisions/use-postgres",
      title: "Use Postgres",
      body: "old",
      updated_at: null,
      content_hash: "hash-snapshot",
      project: null,
      contributions_summary: "",
    };
    const repo: CandidateRepository = { findCandidates: async () => [cand] };
    const plan = await buildApplyPlan({
      payload: storedPayload([decisionSignal()]),
      target: "production",
      repo,
      decider: fixedDecider({ action: "UPDATE", target_slug: "decisions/use-postgres" }),
    });
    expect(plan.actions[0].action).toBe("UPDATE");
    expect(plan.actions[0].target_slug).toBe("decisions/use-postgres");
    expect(plan.actions[0].target_content_hash).toBe("hash-snapshot");
    expect(plan.actions[0].candidates).toHaveLength(1);
  });

  it("coerces an out-of-pool restricted target to NEW", async () => {
    const cand: Candidate = {
      slug: "decisions/real",
      title: "Real",
      body: "",
      updated_at: null,
      content_hash: "h",
      project: null,
      contributions_summary: "",
    };
    const repo: CandidateRepository = { findCandidates: async () => [cand] };
    const plan = await buildApplyPlan({
      payload: storedPayload([decisionSignal()]),
      target: "production",
      repo,
      decider: fixedDecider({ action: "SUPERSEDE", target_slug: "decisions/hallucinated" }),
    });
    expect(plan.actions[0].action).toBe("NEW");
    expect(plan.actions[0].target_slug).toBeNull();
    expect(plan.actions[0].reason).toMatch(/coerced to NEW/);
  });

  it("passes the top-5 candidate limit to the repository", async () => {
    let seenLimit = -1;
    const repo: CandidateRepository = {
      findCandidates: async (_s, limit) => {
        seenLimit = limit;
        return [];
      },
    };
    await buildApplyPlan({
      payload: storedPayload([knowledgeSignal()]),
      target: "production",
      repo,
      decider: fixedDecider({ action: "NEW" }),
    });
    expect(seenLimit).toBe(5);
  });
});

describe("ApplyPlanStore + SchemaCandidateRepository (DB-backed)", () => {
  it("persists a plan per (payload,target) with independent staging/production rows", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = (
        await db.executor.query<{ id: number }>(
          `INSERT INTO distilled_payload (source_instance, session_id, revision_id, content_hash, payload)
           VALUES ('claude-code', 'sess-1', 1, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
        )
      ).rows[0].id;

      const store = new ApplyPlanStore(db.executor);
      const prodId = await store.save({ payload_id: payloadId, target: "production", actions: [] });
      const stagingId = await store.save({ payload_id: payloadId, target: "staging", actions: [] });
      expect(prodId).not.toBe(stagingId);

      // upsert: saving production again returns the same row id.
      const prodId2 = await store.save({
        payload_id: payloadId,
        target: "production",
        actions: [],
      });
      expect(prodId2).toBe(prodId);

      const got = await store.getByPayloadTarget(payloadId, "production");
      expect(got?.id).toBe(prodId);
      expect(got?.target).toBe("production");
    } finally {
      await db.executor.close();
    }
  });

  it("restricts the candidate pool to v2-pipeline pages + identity entity pages", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      // v2 pipeline page — eligible.
      await pages.putPage(
        "decisions/postgres-choice",
        "---\ntitle: Postgres choice\ntype: decision\npipeline: v2\n---\nWe chose Postgres for durability.",
      );
      // identity entity page — eligible.
      await pages.putPage(
        "entities/postgres",
        "---\ntitle: Postgres\ntype: tool\n---\nPostgres the database.",
      );
      // legacy page (no v2 marker, not an entity) — excluded from the pool.
      await pages.putPage(
        "decisions/postgres-legacy",
        "---\ntitle: Postgres legacy\ntype: decision\n---\nLegacy Postgres note.",
      );

      const repo = new SchemaCandidateRepository(db.executor, "production");
      const cands = await repo.findCandidates(
        knowledgeSignal({ topic: "Postgres", what: "Postgres" }),
        5,
      );
      const slugs = cands.map((c) => c.slug);
      expect(slugs).toContain("decisions/postgres-choice");
      expect(slugs).toContain("entities/postgres");
      expect(slugs).not.toContain("decisions/postgres-legacy");
    } finally {
      await db.executor.close();
    }
  });
});
