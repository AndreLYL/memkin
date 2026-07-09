import { describe, expect, it } from "vitest";
import type { DistilledSignal } from "../distiller/contract.js";
import { Database } from "../store/database.js";
import { PageStore } from "../store/pages.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import { ApplyPlanStore, type StoredApplyPlan } from "./candidate-selection.js";
import { ApplyEngine } from "./engine.js";
import { contributionId, normalizeTopic, signalFamilyKey } from "./ids.js";
import type { ApplyAction, ApplyPlanData, PlannedAction } from "./types.js";

const SOURCE = "claude-code";
const SESSION = "sess-1";
const REVISION = 1;

function signal(over: Partial<DistilledSignal> = {}): DistilledSignal {
  return {
    type: "decision",
    topic: "Use Postgres",
    what: "Adopt Postgres",
    why: "durability",
    entities: [],
    authority: "user_confirmed",
    evidence: [{ start: "m1", end: "m2" }],
    persistence_reason: "arch",
    ...over,
  } as DistilledSignal;
}

function plannedAction(sig: DistilledSignal, action: ApplyAction, over: Partial<PlannedAction> = {}): PlannedAction {
  const norm = normalizeTopic(sig.topic);
  return {
    signal_index: 0,
    signal: sig,
    contribution_id: contributionId(REVISION, sig.type, norm),
    signal_family_key: signalFamilyKey(SOURCE, SESSION, sig.type, norm),
    normalized_topic: norm,
    action,
    target_slug: null,
    target_content_hash: null,
    candidates: [],
    reason: "",
    ...over,
  };
}

async function makePayload(db: { executor: SqlExecutor }): Promise<number> {
  const r = await db.executor.query<{ id: number }>(
    `INSERT INTO distilled_payload (source_instance, session_id, revision_id, content_hash, payload)
     VALUES ($1, $2, $3, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
    [SOURCE, SESSION, REVISION],
  );
  return r.rows[0].id;
}

async function savePlan(
  db: { executor: SqlExecutor },
  payloadId: number,
  data: ApplyPlanData,
): Promise<StoredApplyPlan> {
  const store = new ApplyPlanStore(db.executor);
  const id = await store.save(data);
  return { id, payloadId, target: data.target, data };
}

describe("ApplyEngine — single transaction, target-parameterized", () => {
  it("applies a NEW action: page created, contribution active, journal recorded", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await makePayload(db);
      const plan = await savePlan(db, payloadId, {
        payload_id: payloadId,
        target: "production",
        actions: [plannedAction(signal(), "NEW")],
      });
      const outcome = await new ApplyEngine(db.executor).apply(plan);
      expect(outcome.status).toBe("applied");
      expect(outcome.applied).toEqual([{ slug: "decisions/use-postgres", action: "NEW" }]);

      const page = await new PageStore(db.executor).getPage("decisions/use-postgres");
      expect(page).not.toBeNull();
      expect(page?.compiled_truth).toContain("Adopt Postgres");

      const contrib = await db.executor.query<{ active: boolean; platform: string }>(
        `SELECT active, source_ref->>'platform' AS platform FROM memory_contributions
         WHERE canonical_page_id = $1`,
        [page?.id],
      );
      expect(contrib.rows).toHaveLength(1);
      expect(contrib.rows[0].active).toBe(true);
      expect(contrib.rows[0].platform).toBe("claude-code");

      const journal = await db.executor.query<{ kind: string }>(
        `SELECT kind FROM apply_mutation_journal WHERE apply_attempt_id = $1`,
        [outcome.attemptId],
      );
      expect(journal.rows.map((r) => r.kind)).toContain("page_created");
    } finally {
      await db.executor.close();
    }
  });

  it("is idempotent on replay and never duplicates contributions", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await makePayload(db);
      const plan = await savePlan(db, payloadId, {
        payload_id: payloadId,
        target: "production",
        actions: [plannedAction(signal(), "NEW")],
      });
      const engine = new ApplyEngine(db.executor);
      const first = await engine.apply(plan);
      const second = await engine.apply(plan);
      expect(first.replay).toBe(false);
      expect(second.replay).toBe(true);
      expect(second.attemptId).toBe(first.attemptId);

      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM memory_contributions",
      );
      expect(count.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("applies an UPDATE when the CAS snapshot matches", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      const existing = await pages.putPage(
        "decisions/use-postgres",
        "---\ntitle: Use Postgres\ntype: decision\npipeline: v2\n---\nold body",
      );
      const payloadId = await makePayload(db);
      const plan = await savePlan(db, payloadId, {
        payload_id: payloadId,
        target: "production",
        actions: [
          plannedAction(signal(), "UPDATE", {
            target_slug: "decisions/use-postgres",
            target_content_hash: existing.content_hash,
          }),
        ],
      });
      const outcome = await new ApplyEngine(db.executor).apply(plan);
      expect(outcome.status).toBe("applied");

      const page = await pages.getPage("decisions/use-postgres");
      expect(page?.compiled_truth).toContain("Adopt Postgres"); // rematerialized
      const contrib = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM memory_contributions WHERE canonical_page_id = $1 AND active",
        [page?.id],
      );
      expect(contrib.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("dead-letters after one retry when the CAS snapshot never matches", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      await pages.putPage(
        "decisions/use-postgres",
        "---\ntitle: Use Postgres\ntype: decision\npipeline: v2\n---\ncurrent body",
      );
      const payloadId = await makePayload(db);
      const plan = await savePlan(db, payloadId, {
        payload_id: payloadId,
        target: "production",
        actions: [
          plannedAction(signal(), "UPDATE", {
            target_slug: "decisions/use-postgres",
            target_content_hash: "STALE-HASH-NEVER-MATCHES",
          }),
        ],
      });
      const outcome = await new ApplyEngine(db.executor).apply(plan);
      expect(outcome.status).toBe("dead_letter");
      expect(outcome.retried).toBe(true);

      const attempt = await db.executor.query<{ status: string }>(
        "SELECT status FROM apply_attempt WHERE id = $1",
        [outcome.attemptId],
      );
      expect(attempt.rows[0].status).toBe("dead_letter");
      // No contribution was committed (transaction rolled back).
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM memory_contributions",
      );
      expect(count.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("writes to the staging schema when target=staging, leaving production clean", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const payloadId = await makePayload(db);
      const plan = await savePlan(db, payloadId, {
        payload_id: payloadId,
        target: "staging",
        actions: [plannedAction(signal(), "NEW")],
      });
      const outcome = await new ApplyEngine(db.executor).apply(plan);
      expect(outcome.status).toBe("applied");

      const inStaging = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM staging.pages WHERE slug = 'decisions/use-postgres'",
      );
      const inPublic = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM public.pages WHERE slug = 'decisions/use-postgres'",
      );
      expect(inStaging.rows[0].n).toBe(1);
      expect(inPublic.rows[0].n).toBe(0);

      const stgContrib = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM staging.memory_contributions",
      );
      expect(stgContrib.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("SUPERSEDE creates a new page and marks the old one superseded", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const pages = new PageStore(db.executor);
      const old = await pages.putPage(
        "decisions/old-choice",
        "---\ntitle: Old choice\ntype: decision\npipeline: v2\n---\nold decision",
      );
      const payloadId = await makePayload(db);
      const sig = signal({ topic: "New choice", what: "Switch to Y" });
      const plan = await savePlan(db, payloadId, {
        payload_id: payloadId,
        target: "production",
        actions: [
          plannedAction(sig, "SUPERSEDE", {
            target_slug: "decisions/old-choice",
            target_content_hash: old.content_hash,
          }),
        ],
      });
      const outcome = await new ApplyEngine(db.executor).apply(plan);
      expect(outcome.status).toBe("applied");

      const newPage = await pages.getPage("decisions/new-choice");
      expect(newPage?.compiled_truth).toContain("Switch to Y");
      const oldPage = await pages.getPage("decisions/old-choice");
      expect(oldPage?.frontmatter.superseded_by).toBe("decisions/new-choice");
    } finally {
      await db.executor.close();
    }
  });
});
