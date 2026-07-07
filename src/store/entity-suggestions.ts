/**
 * EntityMergeSuggestionStore — persistence for entity merge suggestions
 * (extraction-quality-redesign PR-3, spec §9).
 *
 * Near-duplicate detection (exact same name, Levenshtein-close titles,
 * pinyin-equivalent person names, cross-type name clashes) NEVER merges
 * automatically. It records suggestion rows here; the consolidator sweep
 * aggregates them; the user reviews and either dismisses a suggestion or
 * accepts it and runs the explicit merge machinery
 * (PersonIdentityStore.merge). Accepting a suggestion does not itself execute
 * the merge — merges stay explicit per the identity contract.
 */

import type { EntityHandleType } from "../core/person-identity.js";
import type { SqlExecutor } from "./sql-executor.js";

export type MergeSuggestionReason = "same_name" | "cross_type_name" | "levenshtein" | "pinyin";
export type MergeSuggestionStatus = "pending" | "accepted" | "dismissed";

/** Snapshot row of an entity page, used by the consolidator merge sweep. */
export interface EntityPageRef {
  slug: string;
  type: string;
  title: string;
}

const ENTITY_PAGE_TYPES = ["person", "project", "organization", "tool", "concept"] as const;

export interface MergeSuggestionCandidate {
  entity_type: EntityHandleType;
  from_slug: string;
  into_slug: string;
  reason: MergeSuggestionReason;
  detail?: Record<string, unknown>;
}

export interface MergeSuggestionRow extends Omit<MergeSuggestionCandidate, "detail"> {
  id: number;
  detail: Record<string, unknown> | null;
  status: MergeSuggestionStatus;
  created_at: string;
  resolved_at: string | null;
}

interface RawRow extends Omit<MergeSuggestionRow, "detail"> {
  detail: Record<string, unknown> | string | null;
}

function toRow(r: RawRow): MergeSuggestionRow {
  return {
    ...r,
    detail:
      typeof r.detail === "string" ? (JSON.parse(r.detail) as Record<string, unknown>) : r.detail,
  };
}

export class EntityMergeSuggestionStore {
  constructor(private db: SqlExecutor) {}

  /** Snapshot of all entity pages (slug/type/title) for the merge sweep. */
  async listEntityPages(): Promise<EntityPageRef[]> {
    const r = await this.db.query<EntityPageRef>(
      "SELECT slug, type, title FROM pages WHERE type = ANY($1)",
      [[...ENTITY_PAGE_TYPES]],
    );
    return r.rows;
  }

  /**
   * Record a suggestion candidate. Idempotent on
   * (entity_type, from_slug, into_slug, reason): re-recording a pending row
   * refreshes its detail; a resolved (accepted/dismissed) row is NEVER
   * resurrected — the sweep keeps re-detecting the same pairs and a user
   * dismissal must stick.
   */
  async record(candidate: MergeSuggestionCandidate): Promise<void> {
    await this.db.query(
      `INSERT INTO entity_merge_suggestions (entity_type, from_slug, into_slug, reason, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (entity_type, from_slug, into_slug, reason) DO UPDATE SET
         detail = EXCLUDED.detail
       WHERE entity_merge_suggestions.status = 'pending'`,
      [
        candidate.entity_type,
        candidate.from_slug,
        candidate.into_slug,
        candidate.reason,
        candidate.detail ? JSON.stringify(candidate.detail) : null,
      ],
    );
  }

  /** List pending suggestions, optionally filtered by entity type. */
  async listPending(filter?: { entityType?: EntityHandleType }): Promise<MergeSuggestionRow[]> {
    const where = ["status = 'pending'"];
    const params: unknown[] = [];
    if (filter?.entityType) {
      params.push(filter.entityType);
      where.push(`entity_type = $${params.length}`);
    }
    const r = await this.db.query<RawRow>(
      `SELECT id, entity_type, from_slug, into_slug, reason, detail, status, created_at, resolved_at
       FROM entity_merge_suggestions
       WHERE ${where.join(" AND ")}
       ORDER BY created_at, id`,
      params,
    );
    return r.rows.map(toRow);
  }

  /** Fetch a single suggestion by id. */
  async get(id: number): Promise<MergeSuggestionRow | null> {
    const r = await this.db.query<RawRow>(
      `SELECT id, entity_type, from_slug, into_slug, reason, detail, status, created_at, resolved_at
       FROM entity_merge_suggestions WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /**
   * Resolve a pending suggestion. `accepted` records the user's confirmation —
   * the actual merge is executed separately via the explicit merge machinery.
   */
  async resolve(id: number, status: "accepted" | "dismissed"): Promise<void> {
    await this.db.query(
      `UPDATE entity_merge_suggestions
       SET status = $1, resolved_at = NOW()
       WHERE id = $2 AND status = 'pending'`,
      [status, id],
    );
  }
}
