import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveAssetKey } from "./pg-runtime-provider.js";

/** True if ~/.memkin/data exists and is a non-empty PGLite data dir. */
export function hasExistingPgliteData(home: string): boolean {
  const dir = join(home, ".memkin", "data");
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Decide the default engine for a NEW install (no config yet).
 * Any platform/arch the managed runtime ships a prebuilt tarball for (see
 * RUNTIME_MANIFEST: darwin/linux × arm64/x64) and no existing PGLite data →
 * managed (zero-config real Postgres). Otherwise pglite (safe default: never
 * silently abandons existing data; unsupported platforms like Windows fall
 * back until a runtime tarball ships for them).
 */
export function resolveDefaultEngineForNewInstall(opts: {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  home: string;
}): "managed" | "pglite" {
  const managedSupported = resolveAssetKey(opts.platform, opts.arch) !== undefined;
  if (managedSupported && !hasExistingPgliteData(opts.home)) return "managed";
  return "pglite";
}
