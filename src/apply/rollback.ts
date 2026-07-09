// src/apply/rollback.ts
//
// Contributions-based rollback of one apply (spec §3.1, §6). The single source
// of truth for undo is the contribution set — NOT the page bodies:
//   ① deactivate (active=false) every contribution the apply produced
//   ② replay the NON-derived mutation journal in reverse (safety net)
//   ③ rematerialize each affected page → derived links/tags/timeline/body
//      rebuild from whatever contributions remain active.
//
// Invariants:
//   - Reverse order: a later apply that still has active contributions on an
//     affected page must be rolled back first (spec §6 "后发先回滚").
//   - New-page rollback: a page left with zero active contributions is flagged
//     `orphaned` (by rematerialize) for the consolidator to archive — never
//     blind-deleted, because other sessions / user edits / links may rely on it.
//   - Only NON-derived writes are journaled; derived writes are rebuilt by
//     rematerialize, so the journal never double-touches them.

import type { SqlConn, SqlExecutor } from "../store/sql-executor.js";
import { rematerializeCanonicalPage } from "./rematerialize.js";
import type { ApplyTarget } from "./types.js";

export class ReverseOrderError extends Error {
  constructor(readonly attemptId: number) {
    super(
      `apply_attempt ${attemptId} cannot be rolled back: a later apply still has active contributions on its pages (roll back the later apply first)`,
    );
    this.name = "ReverseOrderError";
  }
}

export interface RollbackOutcome {
  attemptId: number;
  deactivated: number;
  rematerialized: number;
  orphaned: string[];
}

interface JournalRow {
  kind: string;
  inverse: Record<string, unknown> | string;
}

function parseInverse(v: Record<string, unknown> | string): Record<string, unknown> {
  return typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : v;
}

export class ApplyRollback {
  constructor(private readonly ex: SqlExecutor) {}

  async rollback(attemptId: number): Promise<RollbackOutcome> {
    const target = await this.attemptTarget(attemptId);

    return this.ex.transaction(async (tx) => {
      if (target === "staging") {
        await tx.query("SET LOCAL search_path TO staging, public");
      }

      // Pages this apply contributed to (captured before deactivation).
      const pageRows = await tx.query<{ canonical_page_id: number | null }>(
        "SELECT DISTINCT canonical_page_id FROM memory_contributions WHERE apply_attempt_id = $1",
        [attemptId],
      );
      const pageIds = pageRows.rows
        .map((r) => r.canonical_page_id)
        .filter((id): id is number => id !== null);

      // Reverse-order guard: no LATER apply may still be active on these pages.
      if (pageIds.length > 0) {
        const later = await tx.query<{ one: number }>(
          `SELECT 1 AS one FROM memory_contributions
            WHERE active AND apply_attempt_id > $1 AND canonical_page_id = ANY($2::int[])
            LIMIT 1`,
          [attemptId, pageIds],
        );
        if (later.rows.length > 0) throw new ReverseOrderError(attemptId);
      }

      // Lock affected pages for the duration of the rollback.
      if (pageIds.length > 0) {
        await tx.query("SELECT id FROM pages WHERE id = ANY($1::int[]) FOR UPDATE", [pageIds]);
      }

      // ① Deactivate this apply's contributions.
      const deactivated = await tx.query<{ contribution_id: string }>(
        "UPDATE memory_contributions SET active = false WHERE apply_attempt_id = $1 AND active RETURNING contribution_id",
        [attemptId],
      );

      // ② Replay the non-derived mutation journal in reverse.
      const journal = await tx.query<JournalRow>(
        "SELECT kind, inverse FROM public.apply_mutation_journal WHERE apply_attempt_id = $1 ORDER BY seq DESC",
        [attemptId],
      );
      for (const entry of journal.rows) {
        await this.applyInverse(tx, entry.kind, parseInverse(entry.inverse));
      }

      // ③ Rematerialize every affected page; collect the orphaned ones.
      const orphaned: string[] = [];
      for (const pageId of pageIds) {
        const result = await rematerializeCanonicalPage(tx, pageId);
        if (result.orphaned) {
          const slug = await tx.query<{ slug: string }>("SELECT slug FROM pages WHERE id = $1", [
            pageId,
          ]);
          if (slug.rows[0]) orphaned.push(slug.rows[0].slug);
        }
      }

      await tx.query(
        "UPDATE public.apply_attempt SET detail = COALESCE(detail, '{}'::jsonb) || jsonb_build_object('rolled_back', true) WHERE id = $1",
        [attemptId],
      );

      return {
        attemptId,
        deactivated: deactivated.rows.length,
        rematerialized: pageIds.length,
        orphaned,
      };
    });
  }

  private async attemptTarget(attemptId: number): Promise<ApplyTarget> {
    const r = await this.ex.query<{ target: ApplyTarget }>(
      "SELECT target FROM public.apply_attempt WHERE id = $1",
      [attemptId],
    );
    if (r.rows.length === 0) throw new Error(`apply_attempt ${attemptId} not found`);
    return r.rows[0].target;
  }

  /** Undo one journaled NON-derived write. */
  private async applyInverse(
    tx: SqlConn,
    kind: string,
    inverse: Record<string, unknown>,
  ): Promise<void> {
    switch (kind) {
      case "frontmatter_superseded_by": {
        // Restore the previous supersede pointer (or remove it if there was none).
        const slug = String(inverse.slug);
        const prev = inverse.prev as string | null;
        if (prev === null || prev === undefined) {
          await tx.query(
            "UPDATE pages SET frontmatter = frontmatter - 'superseded_by', updated_at = NOW() WHERE slug = $1",
            [slug],
          );
        } else {
          await tx.query(
            "UPDATE pages SET frontmatter = frontmatter || jsonb_build_object('superseded_by', $2::text), updated_at = NOW() WHERE slug = $1",
            [slug, prev],
          );
        }
        break;
      }
      case "page_created":
        // The page becomes orphaned via rematerialize (step ③) rather than being
        // deleted — the consolidator archives it. Nothing to undo destructively.
        break;
      default:
        // Unknown kinds are ignored (forward-compatible safety net).
        break;
    }
  }
}
