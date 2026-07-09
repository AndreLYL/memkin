// src/apply/rematerialize.ts
//
// rematerializeCanonicalPage (spec §6.1) — the v4 core invariant: EVERY
// derivative of a canonical page (system-managed body, primary frontmatter
// source, derived links / tags / timeline, tracker state) is regenerated from
// the page's ACTIVE contributions, inside the caller's transaction. Any
// operation that changes the active set (a new revision, a rollback) finishes by
// calling this. Once a contribution is withdrawn (active=false), the page must
// no longer show its conclusion.
//
// A page that has lost ALL active contributions is marked `orphaned` (frontmatter
// flag) for the consolidator to review — never blind-deleted (spec §3.1 / §6.1),
// because it may already be referenced by other sessions, user edits, or pages.
//
// Table names are unqualified so the write lands in whichever schema the caller
// put first on search_path (production or staging) — this is what makes the
// engine target-agnostic.

import type { SourceRef } from "../core/types.js";
import { rechunkTx } from "../store/chunks.js";
import type { SqlConn } from "../store/sql-executor.js";
import { computeContentHash, replaceAutoSection, stripAutoSection } from "./page-content.js";

const AUTO_PROVENANCE = { auto: "contribution" };

interface ContributionRow {
  contribution_id: string;
  signal_type: string;
  normalized_topic: string;
  authority: string;
  signal: Record<string, unknown> | string;
  source_ref: SourceRef | string | null;
  created_at: string;
}

interface ActiveContribution {
  contributionId: string;
  type: string;
  authority: string;
  what: string;
  why: string | null;
  entities: string[];
  sourceRef: SourceRef | null;
  createdAt: string;
}

export interface RematerializeResult {
  pageId: number;
  activeCount: number;
  orphaned: boolean;
}

function parseJson<T>(v: T | string | null): T | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? (JSON.parse(v) as T) : v;
}

function toActive(row: ContributionRow): ActiveContribution {
  const signal = (parseJson<Record<string, unknown>>(row.signal) ?? {}) as Record<string, unknown>;
  const entities = Array.isArray(signal.entities) ? (signal.entities as string[]) : [];
  return {
    contributionId: row.contribution_id,
    type: row.signal_type,
    authority: row.authority,
    what: String(signal.what ?? ""),
    why: signal.why ? String(signal.why) : null,
    entities,
    sourceRef: parseJson<SourceRef>(row.source_ref),
    createdAt: row.created_at,
  };
}

/** Render the system-managed body from the active contributions (spec §6.1, §7). */
function renderAutoBody(pageType: string, contribs: ActiveContribution[]): string {
  const line = (c: ActiveContribution) => {
    const why = c.why ? ` — ${c.why}` : "";
    const auth = c.authority === "user_confirmed" ? "" : ` _(${c.authority})_`;
    return `- **[${c.type}]** ${c.what}${why}${auth}`;
  };

  if (pageType === "project") {
    // Project tracker (spec §6.1): current state + recent changes, both derived.
    const recent = [...contribs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const state = contribs.map(line).join("\n");
    const changes = recent
      .map((c) => `- ${c.createdAt.slice(0, 10)} · ${c.what}`)
      .join("\n");
    return `## 当前状态\n${state}\n\n## 最近变更\n${changes}`;
  }

  return contribs.map(line).join("\n");
}

/** Pick the primary source (spec §8): first user_confirmed, else earliest. */
function primarySource(contribs: ActiveContribution[]): SourceRef | null {
  const confirmed = contribs.find((c) => c.authority === "user_confirmed" && c.sourceRef);
  if (confirmed) return confirmed.sourceRef;
  const withSource = contribs.find((c) => c.sourceRef);
  return withSource ? withSource.sourceRef : null;
}

async function loadActive(tx: SqlConn, pageId: number): Promise<ActiveContribution[]> {
  const rows = await tx.query<ContributionRow>(
    `SELECT contribution_id, signal_type, normalized_topic, authority, signal, source_ref, created_at::text AS created_at
       FROM memory_contributions
      WHERE canonical_page_id = $1 AND active
      ORDER BY created_at ASC, contribution_id ASC`,
    [pageId],
  );
  return rows.rows.map(toActive);
}

/** Clear all pipeline-derived links/timeline for this page (rebuilt after). */
async function clearDerived(tx: SqlConn, pageId: number): Promise<void> {
  await tx.query(
    `DELETE FROM links WHERE from_page_id = $1 AND provenance->>'auto' = 'contribution'`,
    [pageId],
  );
  await tx.query(
    `DELETE FROM timeline_entries WHERE page_id = $1 AND provenance->>'auto' = 'contribution'`,
    [pageId],
  );
}

async function rebuildTimeline(
  tx: SqlConn,
  pageId: number,
  contribs: ActiveContribution[],
): Promise<void> {
  for (const c of contribs) {
    const date = (c.sourceRef?.timestamp as string | undefined) ?? c.createdAt;
    const provenance = { ...(c.sourceRef ?? {}), ...AUTO_PROVENANCE };
    await tx.query(
      `INSERT INTO timeline_entries (page_id, date, summary, detail, source, provenance)
       VALUES ($1, $2, $3, $4, '', $5::jsonb)
       ON CONFLICT (page_id, date, summary) DO UPDATE SET
         detail = EXCLUDED.detail,
         provenance = EXCLUDED.provenance`,
      [pageId, date, c.what.slice(0, 200), c.why ?? "", JSON.stringify(provenance)],
    );
  }
}

async function rebuildLinks(
  tx: SqlConn,
  pageId: number,
  contribs: ActiveContribution[],
): Promise<void> {
  const names = new Set<string>();
  for (const c of contribs) for (const e of c.entities) if (e.trim()) names.add(e.trim());
  if (names.size === 0) return;
  // Best-effort: link to entity pages that already exist, matched by slug or title.
  const targets = await tx.query<{ id: number }>(
    `SELECT DISTINCT id FROM pages
      WHERE (slug = ANY($2::text[]) OR lower(title) = ANY($3::text[])) AND id <> $1`,
    [
      pageId,
      [...names],
      [...names].map((n) => n.toLowerCase()),
    ],
  );
  for (const t of targets.rows) {
    await tx.query(
      `INSERT INTO links (from_page_id, to_page_id, link_type, context, provenance)
       VALUES ($1, $2, 'mentions', '', $3::jsonb)
       ON CONFLICT (from_page_id, to_page_id, link_type) DO UPDATE SET provenance = EXCLUDED.provenance`,
      [pageId, t.id, JSON.stringify(AUTO_PROVENANCE)],
    );
  }
}

async function ensureTypeTags(
  tx: SqlConn,
  pageId: number,
  contribs: ActiveContribution[],
): Promise<void> {
  const types = new Set(contribs.map((c) => c.type));
  for (const t of types) {
    await tx.query(
      `INSERT INTO tags (page_id, tag) VALUES ($1, $2) ON CONFLICT (page_id, tag) DO NOTHING`,
      [pageId, t],
    );
  }
}

/**
 * Regenerate all derivatives of a canonical page from its active contributions,
 * inside the caller's transaction (spec §6.1). Returns orphaned=true when the
 * page has no active contributions left.
 */
export async function rematerializeCanonicalPage(
  tx: SqlConn,
  pageId: number,
): Promise<RematerializeResult> {
  const pageRes = await tx.query<{
    type: string;
    compiled_truth: string;
    frontmatter: Record<string, unknown> | string;
  }>("SELECT type, compiled_truth, frontmatter FROM pages WHERE id = $1 FOR UPDATE", [pageId]);
  if (pageRes.rows.length === 0) {
    return { pageId, activeCount: 0, orphaned: false };
  }
  const page = pageRes.rows[0];
  const frontmatter = (parseJson<Record<string, unknown>>(page.frontmatter) ?? {}) as Record<
    string,
    unknown
  >;

  const contribs = await loadActive(tx, pageId);
  await clearDerived(tx, pageId);

  if (contribs.length === 0) {
    // Orphaned: strip the auto section and flag for consolidator review.
    const compiled = stripAutoSection(page.compiled_truth);
    const fm = { ...frontmatter, orphaned: true };
    const hash = computeContentHash(compiled, fm);
    await tx.query(
      `UPDATE pages SET compiled_truth = $2, frontmatter = $3::jsonb, content_hash = $4, updated_at = NOW()
        WHERE id = $1`,
      [pageId, compiled, JSON.stringify(fm), hash],
    );
    await rechunkTx(tx, pageId, compiled);
    return { pageId, activeCount: 0, orphaned: true };
  }

  const autoBody = renderAutoBody(page.type, contribs);
  const compiled = replaceAutoSection(page.compiled_truth, autoBody);
  const source = primarySource(contribs);
  const fm: Record<string, unknown> = { ...frontmatter, pipeline: "v2" };
  delete fm.orphaned;
  if (source) fm.source = source;
  const hash = computeContentHash(compiled, fm);

  await tx.query(
    `UPDATE pages SET compiled_truth = $2, frontmatter = $3::jsonb, content_hash = $4, updated_at = NOW()
      WHERE id = $1`,
    [pageId, compiled, JSON.stringify(fm), hash],
  );
  await rechunkTx(tx, pageId, compiled);
  await rebuildTimeline(tx, pageId, contribs);
  await rebuildLinks(tx, pageId, contribs);
  await ensureTypeTags(tx, pageId, contribs);

  return { pageId, activeCount: contribs.length, orphaned: false };
}
