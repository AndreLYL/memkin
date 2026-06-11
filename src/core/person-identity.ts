/**
 * Person identity — Layer 1: typed handle/alias resolution.
 *
 * A person is anchored by a human-readable canonical page slug (e.g.
 * `person/li-yinglong`). Every other way the person is referred to — a Feishu
 * open id, an email, an exact display name, a nickname / 花名 — is a *handle*
 * stored in `person_handles` and pointing at that canonical slug.
 *
 * Resolution rules (mirrors openhuman's `people` resolver contract):
 *   - Strong handles (feishu_open_id / email / name / slug) auto-resolve and
 *     are recorded automatically during canonicalization.
 *   - Weak handles (nickname / 花名) are NEVER created automatically — they
 *     only enter the table via an explicit `addAlias` / `link`, so an
 *     ambiguous nickname like "龙哥" can never silently merge two people.
 *   - Merging two existing person pages is always an explicit operation.
 */

import type { PGlite } from "@electric-sql/pglite";
import { stringify as stringifyYaml } from "yaml";
import type { PageStore } from "../store/pages.js";

export type HandleKind = "feishu_open_id" | "email" | "name" | "nickname" | "slug";
export type HandleStrength = "strong" | "weak";

export interface PersonHandle {
  kind: HandleKind;
  value: string;
  canonical_slug: string;
  strength: HandleStrength;
}

/** Default strength for a handle kind. Nicknames are weak; everything else strong. */
export function defaultStrength(kind: HandleKind): HandleStrength {
  return kind === "nickname" ? "weak" : "strong";
}

/**
 * Canonicalize a handle value for storage and lookup. Emails and open ids are
 * lowercased; names and nicknames are whitespace-collapsed; slugs are passed
 * through (already normalized lowercase).
 */
export function canonicalizeHandleValue(kind: HandleKind, value: string): string {
  const trimmed = value.trim();
  switch (kind) {
    case "email":
    case "feishu_open_id":
      return trimmed.toLowerCase();
    case "name":
    case "nickname":
      return trimmed.replace(/\s+/g, " ");
    case "slug":
      return trimmed;
  }
}

const OPEN_ID_RE = /\bou_[a-zA-Z0-9]+\b/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export interface PersonIdentityStores {
  pages: PageStore;
}

export class PersonIdentityStore {
  constructor(
    private db: PGlite,
    private stores?: PersonIdentityStores,
  ) {}

  /** Resolve a single handle to its canonical person slug, or null. */
  async resolveHandle(kind: HandleKind, value: string): Promise<string | null> {
    const v = canonicalizeHandleValue(kind, value);
    const r = await this.db.query<{ canonical_slug: string }>(
      "SELECT canonical_slug FROM person_handles WHERE kind = $1 AND value = $2",
      [kind, v],
    );
    return r.rows[0]?.canonical_slug ?? null;
  }

  /**
   * Resolve an extraction's (name, modelSlug) to a canonical slug via known
   * handles. Tries strong handles first (slug, embedded open id / email, exact
   * name), then any explicitly-linked nickname. Returns null if nothing known.
   */
  async resolveForExtraction(name: string, modelSlug: string): Promise<string | null> {
    const bySlug = await this.resolveHandle("slug", modelSlug);
    if (bySlug) return bySlug;

    const openId = name.match(OPEN_ID_RE)?.[0];
    if (openId) {
      const hit = await this.resolveHandle("feishu_open_id", openId);
      if (hit) return hit;
    }

    const email = name.match(EMAIL_RE)?.[0];
    if (email) {
      const hit = await this.resolveHandle("email", email);
      if (hit) return hit;
    }

    const byName = await this.resolveHandle("name", name);
    if (byName) return byName;

    // Weak handles resolve too, but only because they were explicitly linked.
    return this.resolveHandle("nickname", name);
  }

  /**
   * Record the strong handles implied by a freshly-canonicalized person
   * (name → slug, slug → slug, and any embedded open id). Idempotent and
   * non-destructive: existing rows are left untouched.
   */
  async recordCanonical(name: string, canonicalSlug: string): Promise<void> {
    await this.insertHandle("name", name, canonicalSlug, "strong", true);
    await this.insertHandle("slug", canonicalSlug, canonicalSlug, "strong", true);
    const openId = name.match(OPEN_ID_RE)?.[0];
    if (openId) {
      await this.insertHandle("feishu_open_id", openId, canonicalSlug, "strong", true);
    }
  }

  /**
   * Explicitly attach a handle (alias) to a canonical person. Defaults to the
   * kind's natural strength. Throws if the handle already points at a
   * different person (use `merge` / `removeHandle` to reassign).
   */
  async addAlias(
    canonicalSlug: string,
    kind: HandleKind,
    value: string,
    strength?: HandleStrength,
  ): Promise<void> {
    const v = canonicalizeHandleValue(kind, value);
    const existing = await this.resolveHandle(kind, v);
    if (existing && existing !== canonicalSlug) {
      throw new Error(
        `handle ${kind}:${v} already maps to '${existing}'; remove it or merge '${existing}' into '${canonicalSlug}' first`,
      );
    }
    await this.insertHandle(kind, v, canonicalSlug, strength ?? defaultStrength(kind), false);
    // Reflect the alias into the page frontmatter so it's visible + searchable.
    if (this.stores?.pages) {
      await this.appendAliasesToPage(canonicalSlug, [v]);
    }
  }

  /** List all handles attached to a canonical person. */
  async listHandles(canonicalSlug: string): Promise<PersonHandle[]> {
    const r = await this.db.query<PersonHandle>(
      "SELECT kind, value, canonical_slug, strength FROM person_handles WHERE canonical_slug = $1 ORDER BY kind, value",
      [canonicalSlug],
    );
    return r.rows;
  }

  /** Remove a handle by (kind, value). */
  async removeHandle(kind: HandleKind, value: string): Promise<void> {
    const v = canonicalizeHandleValue(kind, value);
    await this.db.query("DELETE FROM person_handles WHERE kind = $1 AND value = $2", [kind, v]);
  }

  /**
   * Rename a person's canonical slug (correct a wrong canonicalization).
   * Renames the page, re-points handles + identity_cache, leaves the old slug
   * behind as a resolvable alias.
   */
  async recanonicalize(oldSlug: string, newSlug: string): Promise<void> {
    if (oldSlug === newSlug) return;
    const pages = this.requirePages();
    const page = await pages.getPage(oldSlug);
    if (!page) throw new Error(`person page '${oldSlug}' not found`);
    if (await pages.getPage(newSlug)) {
      throw new Error(`'${newSlug}' already exists; use merge('${oldSlug}', '${newSlug}') instead`);
    }

    await this.db.query("UPDATE pages SET slug = $1, updated_at = NOW() WHERE slug = $2", [
      newSlug,
      oldSlug,
    ]);
    await this.db.query("UPDATE person_handles SET canonical_slug = $1 WHERE canonical_slug = $2", [
      newSlug,
      oldSlug,
    ]);
    await this.insertHandle("slug", oldSlug, newSlug, "strong", false);
    await this.repointIdentityCache(oldSlug, newSlug);

    const renamed = await pages.getPage(newSlug);
    if (renamed) await this.appendAliasesToPage(newSlug, [oldSlug]);
  }

  /**
   * Merge person page `fromSlug` into `intoSlug`. Re-points links, timeline
   * entries, and tags; folds the body and aliases into the target; records the
   * old slug + handles as aliases of the target; deletes the old page.
   *
   * Note: the old page's embeddings (chunks) are dropped with it — run
   * `memoark embed` afterwards to re-embed the folded content.
   */
  async merge(fromSlug: string, intoSlug: string): Promise<void> {
    if (fromSlug === intoSlug) throw new Error("cannot merge a person into itself");
    const pages = this.requirePages();
    const from = await pages.getPage(fromSlug);
    const into = await pages.getPage(intoSlug);
    if (!from) throw new Error(`person page '${fromSlug}' not found`);
    if (!into) throw new Error(`person page '${intoSlug}' not found`);

    const fromId = from.id;
    const intoId = into.id;

    // Re-point outgoing links, skipping rows that would violate the
    // UNIQUE(from_page_id, to_page_id, link_type) constraint, then drop dups.
    await this.db.query(
      `UPDATE links SET from_page_id = $1
       WHERE from_page_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM links l2
           WHERE l2.from_page_id = $1 AND l2.to_page_id = links.to_page_id
             AND l2.link_type = links.link_type
         )`,
      [intoId, fromId],
    );
    await this.db.query("DELETE FROM links WHERE from_page_id = $1", [fromId]);
    // Re-point incoming links.
    await this.db.query(
      `UPDATE links SET to_page_id = $1
       WHERE to_page_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM links l2
           WHERE l2.to_page_id = $1 AND l2.from_page_id = links.from_page_id
             AND l2.link_type = links.link_type
         )`,
      [intoId, fromId],
    );
    await this.db.query("DELETE FROM links WHERE to_page_id = $1", [fromId]);
    // Drop any self-link created by the merge.
    await this.db.query("DELETE FROM links WHERE from_page_id = $1 AND to_page_id = $1", [intoId]);

    // Re-point timeline entries (UNIQUE(page_id, date, summary)).
    await this.db.query(
      `UPDATE timeline_entries SET page_id = $1
       WHERE page_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM timeline_entries t2
           WHERE t2.page_id = $1 AND t2.date = timeline_entries.date
             AND t2.summary = timeline_entries.summary
         )`,
      [intoId, fromId],
    );
    await this.db.query("DELETE FROM timeline_entries WHERE page_id = $1", [fromId]);

    // Re-point tags (UNIQUE(page_id, tag)).
    await this.db.query(
      `UPDATE tags SET page_id = $1
       WHERE page_id = $2
         AND NOT EXISTS (SELECT 1 FROM tags t2 WHERE t2.page_id = $1 AND t2.tag = tags.tag)`,
      [intoId, fromId],
    );
    await this.db.query("DELETE FROM tags WHERE page_id = $1", [fromId]);

    // Fold body + aliases into the target.
    const aliasValues = new Set<string>([
      ...this.frontmatterAliases(into),
      ...this.frontmatterAliases(from),
      fromSlug,
    ]);
    const foldedBody =
      from.compiled_truth.trim().length > 0
        ? `${into.compiled_truth.trimEnd()}\n\n## Merged from ${fromSlug}\n\n${from.compiled_truth.trim()}`
        : into.compiled_truth;
    await this.writePage(into, foldedBody, [...aliasValues]);

    // Re-point handle + identity-cache mappings, then drop the old page.
    await this.db.query("UPDATE person_handles SET canonical_slug = $1 WHERE canonical_slug = $2", [
      intoSlug,
      fromSlug,
    ]);
    await this.insertHandle("slug", fromSlug, intoSlug, "strong", false);
    await this.repointIdentityCache(fromSlug, intoSlug);
    await pages.deletePage(fromSlug);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private requirePages(): PageStore {
    if (!this.stores?.pages) {
      throw new Error("PersonIdentityStore: page operations require a PageStore");
    }
    return this.stores.pages;
  }

  private async insertHandle(
    kind: HandleKind,
    value: string,
    canonicalSlug: string,
    strength: HandleStrength,
    ignoreConflict: boolean,
  ): Promise<void> {
    const v = canonicalizeHandleValue(kind, value);
    if (ignoreConflict) {
      await this.db.query(
        `INSERT INTO person_handles (kind, value, canonical_slug, strength)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, value) DO NOTHING`,
        [kind, v, canonicalSlug, strength],
      );
    } else {
      await this.db.query(
        `INSERT INTO person_handles (kind, value, canonical_slug, strength)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, value) DO UPDATE SET
           canonical_slug = EXCLUDED.canonical_slug,
           strength = EXCLUDED.strength`,
        [kind, v, canonicalSlug, strength],
      );
    }
  }

  private async repointIdentityCache(oldSlug: string, newSlug: string): Promise<void> {
    await this.db.query(
      "UPDATE identity_cache SET display_name = $1 WHERE platform = 'canonical' AND display_name = $2",
      [newSlug, oldSlug],
    );
    await this.db.query(
      `INSERT INTO identity_cache (platform, external_id, display_name, slug_hint)
       VALUES ('canonical', $1, $2, $1)
       ON CONFLICT (platform, external_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [oldSlug, newSlug],
    );
  }

  private frontmatterAliases(page: { frontmatter: Record<string, unknown> }): string[] {
    const a = page.frontmatter.aliases;
    return Array.isArray(a) ? a.map(String) : [];
  }

  private async appendAliasesToPage(slug: string, newAliases: string[]): Promise<void> {
    const pages = this.requirePages();
    const page = await pages.getPage(slug);
    if (!page) return;
    const merged = new Set<string>([...this.frontmatterAliases(page), ...newAliases]);
    await this.writePage(page, page.compiled_truth, [...merged]);
  }

  private async writePage(
    page: { slug: string; title: string; type: string; frontmatter: Record<string, unknown> },
    body: string,
    aliases: string[],
  ): Promise<void> {
    const pages = this.requirePages();
    const { aliases: _drop, ...rest } = page.frontmatter;
    const fm: Record<string, unknown> = {
      title: page.title,
      type: page.type,
      ...rest,
    };
    if (aliases.length > 0) fm.aliases = aliases;
    const content = `---\n${stringifyYaml(fm)}---\n${body}`;
    await pages.putPage(page.slug, content);
  }
}
