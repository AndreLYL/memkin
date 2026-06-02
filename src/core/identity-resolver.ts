import type { PGlite } from "@electric-sql/pglite";
import type { RawMessage } from "./types.js";

export interface IdentityBackend {
  resolveFeishuOpenId(openId: string): Promise<{ name: string; slugHint?: string } | null>;
}

interface CacheRow {
  display_name: string;
  slug_hint: string | null;
}

export class IdentityResolver {
  constructor(
    private db: PGlite,
    private backend?: IdentityBackend,
  ) {}

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
      return row.slug_hint ? `${row.display_name} (${row.slug_hint})` : row.display_name;
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

  async canonicalizeExtractionResult(
    result: import("./types.js").ExtractionResult,
  ): Promise<{ result: import("./types.js").ExtractionResult; aliases: Map<string, string[]> }> {
    return { result, aliases: new Map() };
  }
}
