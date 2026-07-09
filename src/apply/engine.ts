// src/apply/engine.ts
//
// The single, target-agnostic apply engine (spec §6.2). It consumes a frozen
// apply_plan and writes everything in ONE Postgres transaction:
//   pages + content_chunks (via rematerialize's rechunk) + links + tags +
//   timeline + handles + contributions + rematerialize + a mutation journal for
//   the NON-derived writes → commit → record an apply_attempt.
//
// Target parameterization (staging | production) is a `SET LOCAL search_path`
// inside the transaction: data tables (pages, content_chunks, links, tags,
// timeline_entries, memory_contributions) are written UNQUALIFIED and resolve to
// the target schema; engine metadata (apply_attempt, apply_mutation_journal,
// distilled_payload) is always public-qualified.
//
// Replay is idempotent and never calls an LLM: the engine is pure plan
// consumption; contribution_id is the deterministic PK and pages upsert by slug,
// so re-running a plan that already succeeded is a no-op.
//
// CAS: UPDATE/SUPERSEDE/LINK_EXISTING lock the target row and compare its
// content_hash to the plan snapshot; a mismatch (concurrent write) aborts and
// the whole apply is retried once. A second conflict parks the attempt in
// dead_letter (spec §7).

import type { SourceRef } from "../core/types.js";
import type { SqlConn, SqlExecutor } from "../store/sql-executor.js";
import type { StoredApplyPlan } from "./candidate-selection.js";
import { rematerializeCanonicalPage } from "./rematerialize.js";
import type { ApplyAction, ApplyTarget, PlannedAction } from "./types.js";

const TYPE_FOLDER: Record<string, string> = {
  decision: "decisions",
  task: "tasks",
  reference: "references",
  preference: "preferences",
  knowledge: "knowledge",
  discovery: "discoveries",
};

function deriveSlug(type: string, normalizedTopic: string): string {
  const folder = TYPE_FOLDER[type] ?? "notes";
  return `${folder}/${normalizedTopic}`;
}

class CasConflictError extends Error {
  constructor(readonly slug: string) {
    super(`CAS conflict on ${slug}`);
    this.name = "CasConflictError";
  }
}

interface PayloadMeta {
  sourceInstance: string;
  sessionId: string;
  revisionId: number;
  createdAt: string;
}

export interface ApplyOutcome {
  attemptId: number;
  status: "applied" | "failed" | "dead_letter";
  target: ApplyTarget;
  applied: { slug: string; action: ApplyAction }[];
  retried: boolean;
  replay: boolean;
  error?: string;
}

export class ApplyEngine {
  constructor(private readonly ex: SqlExecutor) {}

  /**
   * Apply a frozen plan. Idempotent per plan; target-parameterized; single
   * transaction; CAS with one retry then dead_letter.
   */
  async apply(plan: StoredApplyPlan): Promise<ApplyOutcome> {
    // Idempotent replay: a plan that already applied is not re-run (no LLM ever).
    const prior = await this.ex.query<{ id: number }>(
      "SELECT id FROM public.apply_attempt WHERE plan_id = $1 AND status = 'applied' ORDER BY id DESC LIMIT 1",
      [plan.id],
    );
    if (prior.rows.length > 0) {
      return {
        attemptId: prior.rows[0].id,
        status: "applied",
        target: plan.target,
        applied: [],
        retried: false,
        replay: true,
      };
    }

    const meta = await this.loadPayloadMeta(plan.data.payload_id);
    const attemptId = (
      await this.ex.query<{ id: number }>(
        "INSERT INTO public.apply_attempt (plan_id, target, status) VALUES ($1, $2, 'pending') RETURNING id",
        [plan.id, plan.target],
      )
    ).rows[0].id;

    let retried = false;
    for (let pass = 0; pass < 2; pass++) {
      try {
        const applied = await this.runTransaction(plan, meta, attemptId);
        await this.ex.query(
          "UPDATE public.apply_attempt SET status = 'applied', detail = $2::jsonb, completed_at = NOW() WHERE id = $1",
          [attemptId, JSON.stringify({ retried, count: applied.length })],
        );
        return {
          attemptId,
          status: "applied",
          target: plan.target,
          applied,
          retried,
          replay: false,
        };
      } catch (err) {
        const isCas = err instanceof CasConflictError;
        if (isCas && pass === 0) {
          retried = true;
          continue; // retry once
        }
        const status = isCas ? "dead_letter" : "failed";
        const message = err instanceof Error ? err.message : String(err);
        await this.ex.query(
          "UPDATE public.apply_attempt SET status = $2, detail = $3::jsonb, completed_at = NOW() WHERE id = $1",
          [attemptId, status, JSON.stringify({ retried, error: message })],
        );
        return {
          attemptId,
          status,
          target: plan.target,
          applied: [],
          retried,
          replay: false,
          error: message,
        };
      }
    }
    // Unreachable, but satisfies the type checker.
    return {
      attemptId,
      status: "failed",
      target: plan.target,
      applied: [],
      retried,
      replay: false,
    };
  }

  private async loadPayloadMeta(payloadId: number): Promise<PayloadMeta> {
    const r = await this.ex.query<{
      source_instance: string;
      session_id: string;
      revision_id: number;
      created_at: string;
    }>(
      "SELECT source_instance, session_id, revision_id, created_at::text AS created_at FROM public.distilled_payload WHERE id = $1",
      [payloadId],
    );
    if (r.rows.length === 0) throw new Error(`payload ${payloadId} not found`);
    const row = r.rows[0];
    return {
      sourceInstance: row.source_instance,
      sessionId: row.session_id,
      revisionId: row.revision_id,
      createdAt: row.created_at,
    };
  }

  private async runTransaction(
    plan: StoredApplyPlan,
    meta: PayloadMeta,
    attemptId: number,
  ): Promise<{ slug: string; action: ApplyAction }[]> {
    return this.ex.transaction(async (tx) => {
      if (plan.target === "staging") {
        await tx.query("SET LOCAL search_path TO staging, public");
      }
      const applied: { slug: string; action: ApplyAction }[] = [];
      const journal = new Journal(tx, attemptId);
      for (const action of plan.data.actions) {
        const slug = await this.applyAction(tx, action, meta, attemptId, journal);
        if (slug) applied.push({ slug, action: action.action });
      }
      return applied;
    });
  }

  private async applyAction(
    tx: SqlConn,
    action: PlannedAction,
    meta: PayloadMeta,
    attemptId: number,
    journal: Journal,
  ): Promise<string | null> {
    if (action.action === "NOOP") return null;

    const source: SourceRef = {
      platform: meta.sourceInstance,
      channel: meta.sessionId,
      timestamp: meta.createdAt,
      raw_hash: "",
      quote: "",
    };

    if (action.action === "NEW") {
      const slug = deriveSlug(action.signal.type, action.normalized_topic);
      const pageId = await this.ensurePage(tx, slug, action, journal);
      await this.attachContribution(tx, action, pageId, meta, source, attemptId);
      await rematerializeCanonicalPage(tx, pageId);
      return slug;
    }

    if (action.action === "SUPERSEDE") {
      const oldSlug = action.target_slug as string;
      const old = await this.lockForCas(tx, oldSlug, action.target_content_hash);
      // New page carries the superseding conclusion.
      const newSlug = deriveSlug(action.signal.type, action.normalized_topic);
      const newId = await this.ensurePage(tx, newSlug, action, journal);
      await this.attachContribution(tx, action, newId, meta, source, attemptId);
      await rematerializeCanonicalPage(tx, newId);
      // Non-derived writes on the OLD page → journaled for rollback.
      await this.markSuperseded(tx, old.id, oldSlug, newSlug, journal);
      await tx.query(
        `INSERT INTO links (from_page_id, to_page_id, link_type, context, provenance)
         VALUES ($1, $2, 'supersedes', '', $3::jsonb)
         ON CONFLICT (from_page_id, to_page_id, link_type) DO NOTHING`,
        [newId, old.id, JSON.stringify({ auto: "supersede" })],
      );
      return newSlug;
    }

    // UPDATE | LINK_EXISTING — attach to the existing target and rematerialize.
    const targetSlug = action.target_slug as string;
    const target = await this.lockForCas(tx, targetSlug, action.target_content_hash);
    await this.attachContribution(tx, action, target.id, meta, source, attemptId);
    await rematerializeCanonicalPage(tx, target.id);
    return targetSlug;
  }

  /** Lock the target row and enforce the plan-snapshot CAS (spec §7). */
  private async lockForCas(
    tx: SqlConn,
    slug: string,
    snapshotHash: string | null,
  ): Promise<{ id: number; content_hash: string | null }> {
    const r = await tx.query<{ id: number; content_hash: string | null }>(
      "SELECT id, content_hash FROM pages WHERE slug = $1 FOR UPDATE",
      [slug],
    );
    if (r.rows.length === 0) throw new Error(`apply target page missing: ${slug}`);
    const row = r.rows[0];
    if (snapshotHash !== null && row.content_hash !== snapshotHash) {
      throw new CasConflictError(slug);
    }
    return row;
  }

  /** Insert (or reactivate) the page row; journal a brand-new page for rollback. */
  private async ensurePage(
    tx: SqlConn,
    slug: string,
    action: PlannedAction,
    journal: Journal,
  ): Promise<number> {
    const frontmatter = { pipeline: "v2", authority: action.signal.authority };
    const inserted = await tx.query<{ id: number }>(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter, content_hash)
       VALUES ($1, $2, $3, '', $4::jsonb, '')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [slug, action.signal.type, action.signal.topic, JSON.stringify(frontmatter)],
    );
    if (inserted.rows.length > 0) {
      await journal.record("page_created", { slug });
      return inserted.rows[0].id;
    }
    const existing = await tx.query<{ id: number }>("SELECT id FROM pages WHERE slug = $1", [slug]);
    return existing.rows[0].id;
  }

  private async markSuperseded(
    tx: SqlConn,
    oldId: number,
    oldSlug: string,
    newSlug: string,
    journal: Journal,
  ): Promise<void> {
    const prev = await tx.query<{ superseded_by: string | null }>(
      "SELECT frontmatter->>'superseded_by' AS superseded_by FROM pages WHERE id = $1",
      [oldId],
    );
    await journal.record("frontmatter_superseded_by", {
      slug: oldSlug,
      prev: prev.rows[0]?.superseded_by ?? null,
    });
    await tx.query(
      `UPDATE pages SET frontmatter = frontmatter || jsonb_build_object('superseded_by', $2::text),
         updated_at = NOW() WHERE id = $1`,
      [oldId, newSlug],
    );
  }

  private async attachContribution(
    tx: SqlConn,
    action: PlannedAction,
    pageId: number,
    meta: PayloadMeta,
    source: SourceRef,
    attemptId: number,
  ): Promise<void> {
    // Revision-update semantics (spec §6.1): a new revision of the same family
    // deactivates prior revisions before this contribution goes active.
    await tx.query(
      `UPDATE memory_contributions SET active = false
        WHERE signal_family_key = $1 AND revision_id <> $2 AND active`,
      [action.signal_family_key, meta.revisionId],
    );
    await tx.query(
      `INSERT INTO memory_contributions
         (contribution_id, signal_family_key, canonical_page_id, session_ref, revision_id,
          authority, signal_type, normalized_topic, signal, source_ref, evidence, active, apply_attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, true, $12)
       ON CONFLICT (contribution_id) DO UPDATE SET
         canonical_page_id = EXCLUDED.canonical_page_id,
         active = true,
         apply_attempt_id = EXCLUDED.apply_attempt_id`,
      [
        action.contribution_id,
        action.signal_family_key,
        pageId,
        `${meta.sourceInstance}:${meta.sessionId}`,
        meta.revisionId,
        action.signal.authority,
        action.signal.type,
        action.normalized_topic,
        JSON.stringify(action.signal),
        JSON.stringify(source),
        JSON.stringify(action.signal.evidence ?? []),
        attemptId,
      ],
    );
  }
}

/** Records inverse ops for NON-derived writes only (rollback safety net). */
class Journal {
  private seq = 0;
  constructor(
    private readonly tx: SqlConn,
    private readonly attemptId: number,
  ) {}

  async record(kind: string, inverse: Record<string, unknown>): Promise<void> {
    this.seq += 1;
    await this.tx.query(
      `INSERT INTO public.apply_mutation_journal (apply_attempt_id, seq, kind, inverse)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [this.attemptId, this.seq, kind, JSON.stringify(inverse)],
    );
  }
}
