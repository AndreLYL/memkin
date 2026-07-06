import type { LarkCliHttpClient } from "./lark-cli-client.js";

interface AuthStatusResponse {
  userOpenId?: string;
  tokenStatus?: string;
}

/**
 * Resolve the current Lark user's open_id for use in p2p chat name resolution.
 *
 * Strategy:
 *   1. If `yamlOverride` is provided AND truthy, use it. Operator explicit choice wins,
 *      no lark-cli call made.
 *   2. Otherwise call `client.getAuthStatus()` and parse the `userOpenId` field.
 *      Returns null if tokenStatus is not "valid", the call throws, or the field
 *      is missing.
 *
 * Returning null means "p2p resolution unavailable for this session" — callers
 * should surface a clear error to the user (e.g. "run lark auth login or set
 * feishu.sources.dm.self_open_id in memkin.yaml").
 *
 * Empty string yamlOverride is treated as no override (falls through to lark-cli)
 * since an explicit empty string is more likely a config mistake than intent.
 */
export async function resolveSelfOpenId(
  client: LarkCliHttpClient,
  yamlOverride: string | undefined,
): Promise<string | null> {
  if (yamlOverride) return yamlOverride;
  try {
    const status = await client.getAuthStatus<AuthStatusResponse>();
    if (status.tokenStatus !== "valid") return null;
    return status.userOpenId ?? null;
  } catch {
    return null;
  }
}
