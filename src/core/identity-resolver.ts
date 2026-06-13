import type { PGlite } from "@electric-sql/pglite";
import { PersonIdentityStore } from "./person-identity.js";
import { toPersonCanonicalSlug } from "./person-slug.js";
import type { ExtractionResult, RawMessage } from "./types.js";

export interface IdentityBackend {
  resolveFeishuOpenId(openId: string): Promise<{ name: string; slugHint?: string } | null>;
}

interface CacheRow {
  display_name: string | null;
  slug_hint: string | null;
}

export class IdentityResolver {
  private readonly identity: PersonIdentityStore;

  constructor(
    private db: PGlite,
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
   * Canonicalize all person slugs in an ExtractionResult and rewrite references.
   *
   * @param result - The extraction result to canonicalize
   * @returns Canonicalized result and alias map (canonical -> list of old slugs)
   */
  async canonicalizeExtractionResult(result: ExtractionResult): Promise<{
    result: ExtractionResult;
    aliases: Map<string, string[]>;
  }> {
    // 1. Build rewrite map for person entities
    const rewriteMap = new Map<string, string>();
    const aliasesMap = new Map<string, string[]>();

    for (const entity of result.entities) {
      if (entity.type !== "person") continue;

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
    }

    // 2. Helper to rewrite a slug if it's in the map
    const rewriteSlug = (slug: string): string => {
      return rewriteMap.get(slug) ?? slug;
    };

    // 3. Rewrite entities and deduplicate
    const entityMap = new Map<string, (typeof result.entities)[0]>();
    for (const entity of result.entities) {
      const slug = entity.type === "person" ? rewriteSlug(entity.slug) : entity.slug;

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

    return { result: canonicalized, aliases: aliasesMap };
  }
}
