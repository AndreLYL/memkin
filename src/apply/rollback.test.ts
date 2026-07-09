import { describe, expect, it } from "vitest";
import type { DistilledSignal } from "../distiller/contract.js";
import { Database } from "../store/database.js";
import { PageStore } from "../store/pages.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import { ApplyPlanStore, type StoredApplyPlan } from "./candidate-selection.js";
import { ApplyEngine, type ApplyOutcome } from "./engine.js";
import { contributionId, normalizeTopic, signalFamilyKey } from "./ids.js";
import { ApplyRollback, ReverseOrderError } from "./rollback.js";
import type { ApplyAction, ApplyPlanData, PlannedAction } from "./types.js";

const SOURCE = "claude-code";
const SESSION = "sess-1";

function signal(topic: string, what: string): DistilledSignal {
  return {
    type: "decision",
    topic,
    what,
    entities: [],
    authority: "user_confirmed",
    evidence: [{ start: "m1", end: "m2" }],
    persistence_reason: "arch",
  } as DistilledSignal;
}

async function applyOne(
  db: { executor: SqlExecutor },
  revision: number,
  sig: DistilledSignal,
  action: ApplyAction,
  extra: Partial<PlannedAction> = {},
  target: "production" | "staging" = "production",
): Promise<ApplyOutcome> {
  const payloadId = (
    await db.executor.query<{ id: number }>(
      `INSERT INTO distilled_payload (source_instance, session_id, revision_id, content_hash, payload)
       VALUES ($1, $2, $3, 'h', '{"signals":[]}'::jsonb) RETURNING id`,
      [SOURCE, SESSION, revision],
    )
  ).rows[0].id;
  const norm = normalizeTopic(sig.topic);
  const pa: PlannedAction = {
    signal_index: 0,
    signal: sig,
    contribution_id: contributionId(revision, sig.type, norm),
    signal_family_key: signalFamilyKey(SOURCE, SESSION, sig.type, norm),
    normalized_topic: norm,
    action,
    target_slug: null,
    target_content_hash: null,
    candidates: [],
    reason: "",
    ...extra,
  };
  const data: ApplyPlanData = { payload_id: payloadId, target, actions: [pa] };
  const planId = await new ApplyPlanStore(db.executor).save(data);
  const plan: StoredApplyPlan = { id: planId, payloadId, target, data };
  return new ApplyEngine(db.executor).apply(plan);
}

describe("ApplyRollback — contributions-based, reverse-order", () => {
  it("deactivates the apply's contributions and orphans a now-empty new page", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const out = await applyOne(db, 1, signal("Use Postgres", "Adopt Postgres"), "NEW");
      const rb = await new ApplyRollback(db.executor).rollback(out.attemptId);
      expect(rb.deactivated).toBe(1);
      expect(rb.orphaned).toContain("decisions/use-postgres");

      const pages = new PageStore(db.executor);
      const page = await pages.getPage("decisions/use-postgres");
      expect(page).not.toBeNull(); // not deleted
      expect(page?.frontmatter.orphaned).toBe(true);
      expect(page?.compiled_truth).not.toContain("Adopt Postgres");
    } finally {
      await db.executor.close();
    }
  });

  it("keeps a page alive when another apply's contribution still supports it", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const a1 = await applyOne(db, 1, signal("Use Postgres", "Adopt Postgres"), "NEW");
      const page = await new PageStore(db.executor).getPage("decisions/use-postgres");
      // Second apply adds a distinct contribution (different topic) to the same page.
      const a2 = await applyOne(db, 2, signal("Backup strategy", "Nightly backups"), "UPDATE", {
        target_slug: "decisions/use-postgres",
        target_content_hash: page?.content_hash ?? null,
      });

      // Roll back the LATER apply (a2) — allowed.
      const rb = await new ApplyRollback(db.executor).rollback(a2.attemptId);
      expect(rb.orphaned).toHaveLength(0);
      const after = await new PageStore(db.executor).getPage("decisions/use-postgres");
      expect(after?.compiled_truth).toContain("Adopt Postgres"); // a1 still active
      expect(after?.compiled_truth).not.toContain("Nightly backups");
      expect(after?.frontmatter.orphaned).toBeUndefined();
    } finally {
      await db.executor.close();
    }
  });

  it("enforces reverse order (later apply must be rolled back first)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const a1 = await applyOne(db, 1, signal("Use Postgres", "Adopt Postgres"), "NEW");
      const page = await new PageStore(db.executor).getPage("decisions/use-postgres");
      const a2 = await applyOne(db, 2, signal("Backup strategy", "Nightly backups"), "UPDATE", {
        target_slug: "decisions/use-postgres",
        target_content_hash: page?.content_hash ?? null,
      });

      const rollback = new ApplyRollback(db.executor);
      await expect(rollback.rollback(a1.attemptId)).rejects.toBeInstanceOf(ReverseOrderError);

      // Correct order: a2 then a1.
      await rollback.rollback(a2.attemptId);
      const rb1 = await rollback.rollback(a1.attemptId);
      expect(rb1.orphaned).toContain("decisions/use-postgres");
    } finally {
      await db.executor.close();
    }
  });

  it("restores the old page's frontmatter when rolling back a SUPERSEDE (journal inverse)", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      const old = await new PageStore(db.executor).putPage(
        "decisions/old-choice",
        "---\ntitle: Old choice\ntype: decision\npipeline: v2\n---\nold decision",
      );
      const out = await applyOne(db, 1, signal("New choice", "Switch to Y"), "SUPERSEDE", {
        target_slug: "decisions/old-choice",
        target_content_hash: old.content_hash,
      });
      // Sanity: old page marked superseded by the new page.
      let oldPage = await new PageStore(db.executor).getPage("decisions/old-choice");
      expect(oldPage?.frontmatter.superseded_by).toBe("decisions/new-choice");

      await new ApplyRollback(db.executor).rollback(out.attemptId);
      oldPage = await new PageStore(db.executor).getPage("decisions/old-choice");
      expect(oldPage?.frontmatter.superseded_by).toBeUndefined();
    } finally {
      await db.executor.close();
    }
  });
});
