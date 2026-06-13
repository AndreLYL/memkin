import type { PGlite } from "@electric-sql/pglite";
import type { IdentityBackend } from "../../core/identity-resolver.js";

const PLATFORM = "feishu:chat";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheRow {
  display_name: string | null;
  resolved_at: string;
}

export type ResolutionOutcome =
  | { kind: "resolved"; name: string }
  | { kind: "failed" }
  | { kind: "skipped"; name: string | null }
  | { kind: "transient_error"; error: string };

export class ChatNameResolver {
  constructor(
    private readonly pg: PGlite,
    private readonly backend: IdentityBackend,
  ) {}

  /** Convenience wrapper returning just the name (null on cache miss or failure). */
  async resolve(channel: string): Promise<string | null> {
    const outcome = await this.refresh(channel);
    if (outcome.kind === "resolved") return outcome.name;
    if (outcome.kind === "skipped") return outcome.name;
    return null;
  }

  /**
   * Try to (re)populate the cache for one channel.
   * - kind=skipped: cache hit within TTL (name may be null = cached failure)
   * - kind=resolved: backend success, cache upserted with new name
   * - kind=failed: backend returned null (permanent failure), cache marked with display_name=NULL
   * - kind=transient_error: backend threw (network/timeout); cache NOT touched, caller may retry
   */
  async refresh(channel: string): Promise<ResolutionOutcome> {
    const cached = await this.readCache(channel);
    if (cached && this.isFresh(cached.resolved_at)) {
      return { kind: "skipped", name: cached.display_name };
    }

    let result: { name: string } | null;
    try {
      result = await this.backend.resolveFeishuChatId(channel);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { kind: "transient_error", error: msg };
    }

    if (result) {
      await this.upsert(channel, result.name);
      return { kind: "resolved", name: result.name };
    }

    await this.upsert(channel, null);
    return { kind: "failed" };
  }

  private async readCache(channel: string): Promise<CacheRow | null> {
    const result = await this.pg.query<CacheRow>(
      `SELECT display_name, resolved_at FROM identity_cache
       WHERE platform = $1 AND external_id = $2`,
      [PLATFORM, channel],
    );
    return result.rows[0] ?? null;
  }

  private isFresh(resolvedAt: string): boolean {
    const ageMs = Date.now() - new Date(resolvedAt).getTime();
    return ageMs < TTL_MS;
  }

  private async upsert(channel: string, displayName: string | null): Promise<void> {
    await this.pg.query(
      `INSERT INTO identity_cache (platform, external_id, display_name, resolved_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (platform, external_id)
       DO UPDATE SET display_name = EXCLUDED.display_name, resolved_at = EXCLUDED.resolved_at`,
      [PLATFORM, channel, displayName],
    );
  }
}
