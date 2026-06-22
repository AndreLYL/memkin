import { describe, expect, it, vi } from "vitest";
import type { IdentityBackend } from "../../core/identity-resolver.js";
import { Database } from "../../store/database.js";
import { ChatNameResolver } from "./chat-name-resolver.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function mockBackend(stub: Record<string, { name: string } | null>): IdentityBackend {
  return {
    resolveFeishuOpenId: async () => null,
    resolveFeishuChatId: vi.fn(async (channel: string) => stub[channel] ?? null),
  };
}

async function freshDb() {
  return Database.create(undefined, { embeddingDimensions: 768 });
}

describe("ChatNameResolver — cache read + TTL", () => {
  it("returns cached display_name within TTL without calling backend", async () => {
    const db = await freshDb();
    await db.pg.query(
      "INSERT INTO identity_cache (platform, external_id, display_name, resolved_at) VALUES ($1, $2, $3, NOW())",
      ["feishu:chat", "group/oc_known", "已缓存群"],
    );
    const backend = mockBackend({});
    const resolver = new ChatNameResolver(db.pg, backend);
    const result = await resolver.resolve("group/oc_known");
    expect(result).toBe("已缓存群");
    expect(backend.resolveFeishuChatId).not.toHaveBeenCalled();
    await db.pg.close();
  });

  it("re-resolves and overwrites when cache entry is older than TTL", async () => {
    const db = await freshDb();
    const staleTime = new Date(Date.now() - SEVEN_DAYS_MS - 60_000).toISOString();
    await db.pg.query(
      "INSERT INTO identity_cache (platform, external_id, display_name, resolved_at) VALUES ($1, $2, $3, $4)",
      ["feishu:chat", "group/oc_stale", "旧名字", staleTime],
    );
    const backend = mockBackend({ "group/oc_stale": { name: "新名字" } });
    const resolver = new ChatNameResolver(db.pg, backend);
    const result = await resolver.resolve("group/oc_stale");
    expect(result).toBe("新名字");
    expect(backend.resolveFeishuChatId).toHaveBeenCalledTimes(1);
    const row = await db.pg.query<{ display_name: string }>(
      "SELECT display_name FROM identity_cache WHERE external_id = 'group/oc_stale'",
    );
    expect(row.rows[0]?.display_name).toBe("新名字");
    await db.pg.close();
  });

  it("returns null and writes failure marker when backend returns null", async () => {
    const db = await freshDb();
    const backend = mockBackend({ "group/oc_fail": null });
    const resolver = new ChatNameResolver(db.pg, backend);
    const result = await resolver.resolve("group/oc_fail");
    expect(result).toBeNull();
    const row = await db.pg.query<{ display_name: string | null; resolved_at: string }>(
      "SELECT display_name, resolved_at FROM identity_cache WHERE external_id = 'group/oc_fail'",
    );
    expect(row.rows[0]?.display_name).toBeNull();
    expect(row.rows[0]?.resolved_at).toBeTruthy();
    await db.pg.close();
  });

  it("skips re-resolution for cached permanent failure within TTL", async () => {
    const db = await freshDb();
    await db.pg.query(
      "INSERT INTO identity_cache (platform, external_id, display_name, resolved_at) VALUES ($1, $2, NULL, NOW())",
      ["feishu:chat", "group/oc_cached_fail"],
    );
    const backend = mockBackend({});
    const resolver = new ChatNameResolver(db.pg, backend);
    const result = await resolver.resolve("group/oc_cached_fail");
    expect(result).toBeNull();
    expect(backend.resolveFeishuChatId).not.toHaveBeenCalled();
    await db.pg.close();
  });

  it("does not touch cache when backend throws (transient_error)", async () => {
    const db = await freshDb();
    const backend: IdentityBackend = {
      resolveFeishuOpenId: async () => null,
      resolveFeishuChatId: vi.fn(async () => {
        throw new Error("network timeout");
      }),
    };
    const resolver = new ChatNameResolver(db.pg, backend);
    const outcome = await resolver.refresh("group/oc_throw");
    expect(outcome.kind).toBe("transient_error");
    if (outcome.kind === "transient_error") {
      expect(outcome.error).toContain("network timeout");
    }
    const row = await db.pg.query(
      "SELECT 1 FROM identity_cache WHERE platform = 'feishu:chat' AND external_id = 'group/oc_throw'",
    );
    expect(row.rows).toHaveLength(0); // no cache write on throw
    await db.pg.close();
  });
});
