import type { SqlExecutor } from "../store/sql-executor.js";
import { type EntityHandleType, PersonIdentityStore } from "./person-identity.js";
import { toPersonCanonicalSlug } from "./person-slug.js";
import type { ExtractionResult, RawMessage } from "./types.js";

export interface IdentityBackend {
  resolveFeishuOpenId(openId: string): Promise<{ name: string; slugHint?: string } | null>;
  // Resolves a full channel string (e.g. "group/oc_xxx" or "dm/oc_xxx") to a
  // human-readable display name. Returns null when the channel kind is "mail"
  // (caller should short-circuit), when self_open_id is unavailable for a p2p
  // chat, or when the underlying Lark API returns a non-network error.
  resolveFeishuChatId(channel: string): Promise<{ name: string } | null>;
}

interface CacheRow {
  display_name: string | null;
  slug_hint: string | null;
}

/** Entity types that go through tiered name-handle normalization (spec §9). */
export type NormalizableEntityType = "project" | "tool";

/**
 * A merge candidate produced when entity normalization refuses to auto-bind
 * (same-name-multiple-pages or cross-type name clash). Never acted on
 * automatically — persisted as entity_merge_suggestions for user review.
 */
export interface EntityMergeCandidate {
  entity_type: EntityHandleType;
  from_slug: string;
  into_slug: string;
  reason: "same_name" | "cross_type_name";
  detail?: Record<string, unknown>;
}

/** Entity page types considered when checking exact-name uniqueness store-wide. */
const ENTITY_PAGE_TYPES = ["person", "project", "organization", "tool", "concept"] as const;

export class IdentityResolver {
  private readonly identity: PersonIdentityStore;

  constructor(
    private db: SqlExecutor,
    private backend?: IdentityBackend,
  ) {
    this.identity = new PersonIdentityStore(db);
  }

  async enrichBatch(messages: RawMessage[]): Promise<RawMessage[]> {
    const unresolvedIds = new Set<string>();
    for (const msg of messages) {
      if (this.isUnresolvedId(msg.contact)) {
        unresolvedIds.add(msg.contact);
      }
    }

    if (unresolvedIds.size === 0) return messages;

    const resolved = new Map<string, string>();

    for (const id of unresolvedIds) {
      const name = await this.resolve("feishu", id);
      if (name) resolved.set(id, name);
    }

    return messages.map((msg) => {
      const name = resolved.get(msg.contact);
      if (!name) return msg;
      return { ...msg, contact: name };
    });
  }

  private async resolve(platform: string, externalId: string): Promise<string | null> {
    const cached = await this.db.query<CacheRow>(
      "SELECT display_name, slug_hint FROM identity_cache WHERE platform = $1 AND external_id = $2",
      [platform, externalId],
    );

    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      if (row.display_name) {
        return row.slug_hint ? `${row.display_name} (${row.slug_hint})` : row.display_name;
      }
      // display_name is NULL — cache row exists but is incomplete; fall through to backend
    }

    if (!this.backend) return null;

    try {
      const result = await this.backend.resolveFeishuOpenId(externalId);
      if (!result) return null;

      await this.db.query(
        `INSERT INTO identity_cache (platform, external_id, display_name, slug_hint)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (platform, external_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           slug_hint = EXCLUDED.slug_hint,
           resolved_at = NOW()`,
        [platform, externalId, result.name, result.slugHint ?? null],
      );

      return result.slugHint ? `${result.name} (${result.slugHint})` : result.name;
    } catch (error) {
      console.warn(`[IdentityResolver] Failed to resolve ${externalId}:`, error);
      return null;
    }
  }

  private isUnresolvedId(contact: string): boolean {
    return contact.startsWith("ou_");
  }

  /**
   * Canonicalize a person slug using pinyin rules and cache the result.
   *
   * @param name - The person's display name (e.g., "王建都")
   * @param modelSlug - The model-produced slug (e.g., "person/wang-jian-du")
   * @returns Canonical slug and whether the input was an alias
   */
  async canonicalizePersonSlug(
    name: string,
    modelSlug: string,
  ): Promise<{ slug: string; isAlias: boolean }> {
    // 0. Explicit handle table wins (Layer 1): a previously-linked alias —
    //    open id / email / exact name / nickname — pins the canonical slug.
    const byHandle = await this.identity.resolveForExtraction(name, modelSlug);
    if (byHandle) {
      return { slug: byHandle, isAlias: modelSlug !== byHandle };
    }

    // 1. Check cache by modelSlug
    const cacheBySlug = await this.db.query<{ display_name: string | null }>(
      "SELECT display_name FROM identity_cache WHERE platform = $1 AND external_id = $2",
      ["canonical", modelSlug],
    );

    if (cacheBySlug.rows.length > 0) {
      const canonicalSlug = cacheBySlug.rows[0].display_name;
      if (canonicalSlug) return { slug: canonicalSlug, isAlias: modelSlug !== canonicalSlug };
      // display_name is NULL: deliberate fallthrough — cacheByName (Step 2) may still have a valid canonical
    }

    // 2. Check cache by name
    const cacheByName = await this.db.query<{ display_name: string | null }>(
      "SELECT display_name FROM identity_cache WHERE platform = $1 AND external_id = $2",
      ["canonical", name],
    );

    if (cacheByName.rows.length > 0) {
      const canonicalSlug = cacheByName.rows[0].display_name;
      if (canonicalSlug) {
        // Insert modelSlug -> canonical mapping (if not already there)
        await this.db.query(
          `INSERT INTO identity_cache (platform, external_id, display_name, slug_hint)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (platform, external_id) DO NOTHING`,
          ["canonical", modelSlug, canonicalSlug, name],
        );

        return { slug: canonicalSlug, isAlias: modelSlug !== canonicalSlug };
      }
      // display_name is NULL: treat as cache miss, fall through to pinyin step
    }

    // 3. Generate canonical slug
    const canonicalSlug = toPersonCanonicalSlug(name);

    // 4. If null (unsupported script), return original
    if (canonicalSlug === null) {
      return { slug: modelSlug, isAlias: false };
    }

    // 5. Collision guard: check if canonical slug already exists with different name
    const collision = await this.db.query<{ slug_hint: string }>(
      "SELECT slug_hint FROM identity_cache WHERE platform = $1 AND display_name = $2 AND slug_hint != $3",
      ["canonical", canonicalSlug, name],
    );

    if (collision.rows.length > 0) {
      const canonicalOpenId = canonicalSlug.match(/^person\/(ou_[a-z0-9]+)$/)?.[1];
      const nameOpenId = name.match(/\bou_[a-zA-Z0-9]+\b/)?.[0].toLowerCase();
      if (!canonicalOpenId || canonicalOpenId !== nameOpenId) {
        console.warn(
          `[IdentityResolver] Slug collision detected: canonical slug '${canonicalSlug}' already exists for '${collision.rows[0].slug_hint}', keeping original slug '${modelSlug}' for '${name}'`,
        );
        return { slug: modelSlug, isAlias: false };
      }
    }

    // 6. Insert both mappings: modelSlug -> canonical and name -> canonical
    await this.db.query(
      `INSERT INTO identity_cache (platform, external_id, display_name, slug_hint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, external_id) DO NOTHING`,
      ["canonical", modelSlug, canonicalSlug, name],
    );

    await this.db.query(
      `INSERT INTO identity_cache (platform, external_id, display_name, slug_hint)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, external_id) DO NOTHING`,
      ["canonical", name, canonicalSlug, name],
    );

    // Record the strong handles (name/slug/open id) so future explicit aliases
    // and merges can build on a populated handle table.
    await this.identity.recordCanonical(name, canonicalSlug);

    return { slug: canonicalSlug, isAlias: modelSlug !== canonicalSlug };
  }

  /**
   * Canonicalize a project/tool entity slug via the tiered strong-handle
   * contract (spec §9):
   *
   *   1. A handle already recorded in the (entity_type, scope) namespace wins.
   *   2. Exact name matching EXACTLY ONE page of the same type store-wide, with
   *      no other entity page of another type sharing the name → auto-bind and
   *      record the name handle.
   *   3. Same-name-multiple-pages or a cross-type clash (Codex the tool vs
   *      Codex the project) → NO bind; only `entity_merge_suggestions`
   *      candidates are produced for user review.
   *   4. Brand-new name → keep the model slug and record its name handle so
   *      later slug variants of the same name converge deterministically.
   *
   * Near-miss names (Levenshtein / pinyin) NEVER bind here — fuzzy detection
   * lives in the consolidator sweep and also only produces suggestions.
   */
  async canonicalizeEntitySlug(
    type: NormalizableEntityType,
    name: string,
    modelSlug: string,
  ): Promise<{ slug: string; isAlias: boolean; suggestions: EntityMergeCandidate[] }> {
    // 1. Existing handle in this namespace pins the canonical slug.
    const bySlug = await this.identity.resolveEntityHandle(type, "slug", modelSlug);
    if (bySlug) return { slug: bySlug, isAlias: modelSlug !== bySlug, suggestions: [] };
    const byName = await this.identity.resolveEntityHandle(type, "name", name);
    if (byName) return { slug: byName, isAlias: modelSlug !== byName, suggestions: [] };

    // 2. Exact-title candidates across all entity page types.
    const collapsedName = name.trim().replace(/\s+/g, " ");
    const candidates = await this.db.query<{ slug: string; type: string }>(
      `SELECT slug, type FROM pages
       WHERE title = $1 AND type = ANY($2)
       ORDER BY slug`,
      [collapsedName, [...ENTITY_PAGE_TYPES]],
    );
    const sameType = candidates.rows.filter((r) => r.type === type);
    const crossType = candidates.rows.filter((r) => r.type !== type);

    // 3a. Unique same-type page and no cross-type clash → strong bind.
    if (sameType.length === 1 && crossType.length === 0) {
      const canonicalSlug = sameType[0].slug;
      await this.identity.recordEntityCanonical(type, collapsedName, canonicalSlug);
      return { slug: canonicalSlug, isAlias: modelSlug !== canonicalSlug, suggestions: [] };
    }

    // 3b. Conflicts → suggestions only, keep the model slug, record nothing.
    const suggestions: EntityMergeCandidate[] = [];
    if (sameType.length > 1) {
      // The same-type pages are duplicates of each other; suggest folding later
      // slugs into the first (sorted) one.
      const [first, ...rest] = sameType;
      for (const dup of rest) {
        suggestions.push({
          entity_type: type,
          from_slug: dup.slug,
          into_slug: first.slug,
          reason: "same_name",
          detail: { name: collapsedName },
        });
      }
    }
    for (const clash of crossType) {
      suggestions.push({
        entity_type: type,
        from_slug: modelSlug,
        into_slug: clash.slug,
        reason: "cross_type_name",
        detail: { name: collapsedName, clash_type: clash.type },
      });
    }
    if (suggestions.length > 0) {
      return { slug: modelSlug, isAlias: false, suggestions };
    }

    // 4. Brand-new entity: keep the model slug, record its strong name handle
    //    so future slug variants of this exact name converge.
    await this.identity.recordEntityCanonical(type, collapsedName, modelSlug);
    return { slug: modelSlug, isAlias: false, suggestions: [] };
  }

  /**
   * Canonicalize all person + project/tool slugs in an ExtractionResult and
   * rewrite references.
   *
   * @param result - The extraction result to canonicalize
   * @returns Canonicalized result, person alias map (canonical -> old slugs),
   *          and entity merge suggestions produced by refused auto-binds.
   */
  async canonicalizeExtractionResult(result: ExtractionResult): Promise<{
    result: ExtractionResult;
    aliases: Map<string, string[]>;
    suggestions: EntityMergeCandidate[];
  }> {
    // 1. Build rewrite map for person + project/tool entities
    const rewriteMap = new Map<string, string>();
    const aliasesMap = new Map<string, string[]>();
    const suggestions: EntityMergeCandidate[] = [];

    for (const entity of result.entities) {
      if (entity.type === "person") {
        const { slug: canonicalSlug, isAlias } = await this.canonicalizePersonSlug(
          entity.name,
          entity.slug,
        );

        rewriteMap.set(entity.slug, canonicalSlug);

        if (isAlias && entity.slug !== canonicalSlug) {
          if (!aliasesMap.has(canonicalSlug)) {
            aliasesMap.set(canonicalSlug, []);
          }
          const aliases = aliasesMap.get(canonicalSlug);
          if (aliases) {
            aliases.push(entity.slug);
          }
        }
      } else if (entity.type === "project" || entity.type === "tool") {
        const r = await this.canonicalizeEntitySlug(entity.type, entity.name, entity.slug);
        rewriteMap.set(entity.slug, r.slug);
        suggestions.push(...r.suggestions);
      }
    }

    // 2. Helper to rewrite a slug if it's in the map
    const rewriteSlug = (slug: string): string => {
      return rewriteMap.get(slug) ?? slug;
    };

    // 3. Rewrite entities and deduplicate
    const entityMap = new Map<string, (typeof result.entities)[0]>();
    for (const entity of result.entities) {
      const slug = rewriteMap.has(entity.slug) ? rewriteSlug(entity.slug) : entity.slug;

      // Keep first entity for each canonical slug
      if (!entityMap.has(slug)) {
        entityMap.set(slug, { ...entity, slug });
      }
    }

    // 4. Rewrite all slug references
    const canonicalized: ExtractionResult = {
      source: result.source,
      entities: Array.from(entityMap.values()),
      timeline: result.timeline.map((t) => ({
        ...t,
        entities: t.entities.map(rewriteSlug),
      })),
      links: result.links.map((link) => ({
        ...link,
        from: rewriteSlug(link.from),
        to: rewriteSlug(link.to),
      })),
      decisions: result.decisions.map((d) => ({
        ...d,
        entities: d.entities.map(rewriteSlug),
      })),
      tasks: result.tasks.map((task) => ({
        ...task,
        owner: task.owner?.startsWith("person/") ? rewriteSlug(task.owner) : task.owner,
      })),
      discoveries: result.discoveries.map((d) => ({
        ...d,
        entities: d.entities.map(rewriteSlug),
      })),
      knowledge: result.knowledge.map((k) => ({
        ...k,
        related_entities: k.related_entities.map(rewriteSlug),
      })),
      preferences: (result.preferences ?? []).map((p) => ({
        ...p,
        entities: p.entities.map(rewriteSlug),
      })),
      references: (result.references ?? []).map((r) => ({
        ...r,
        entities: r.entities.map(rewriteSlug),
      })),
    };

    return { result: canonicalized, aliases: aliasesMap, suggestions };
  }
}
