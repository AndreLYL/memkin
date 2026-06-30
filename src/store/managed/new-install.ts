import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** True if ~/.memoark/data exists and is a non-empty PGLite data dir. */
export function hasExistingPgliteData(home: string): boolean {
  const dir = join(home, ".memoark", "data");
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Decide the default engine for a NEW install (no config yet).
 * macOS + no existing PGLite data → managed (zero-config). Otherwise pglite (safe default,
 * never silently abandons existing data; linux/win not yet supported by managed → SP2b).
 */
export function resolveDefaultEngineForNewInstall(opts: {
  platform: NodeJS.Platform;
  home: string;
}): "managed" | "pglite" {
  if (opts.platform === "darwin" && !hasExistingPgliteData(opts.home)) return "managed";
  return "pglite";
}
