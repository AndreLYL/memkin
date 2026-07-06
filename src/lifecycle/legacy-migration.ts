/**
 * Legacy data auto-migration (R2): memoark → memkin.
 *
 * R1 renamed every default with NO fallback (config file, ~/.memkin data dir,
 * project-local .memkin/ state dir). Existing users — whose real memories live
 * under the old memoark paths — would silently start from scratch. This module
 * performs a one-shot, seamless migration at CLI startup so nothing is lost.
 *
 * It is invoked ONCE, early in CLI boot (a commander `preAction` hook), BEFORE
 * loadConfig reads memkin.yaml or any store is opened. It covers three moves:
 *
 *   1. user data dir   ~/.memoark      → ~/.memkin
 *   2. config file      memoark.yaml   → memkin.yaml   (default name, cwd search)
 *   3. project state    ./.memoark/    → ./.memkin/
 *
 * Design rules (see R2 spec):
 *   - rename-only (fs.renameSync). NEVER copy-recursive — a half-copied SQLite/PG
 *     dir is worse than none. On EXDEV / any rename failure we leave the old dir
 *     in place and print an actionable manual-move instruction.
 *   - both old + new exist → NEVER merge, NEVER delete. Use new, warn once.
 *   - neither exists → silent no-op (fresh install stays zero-noise).
 *   - idempotent: after a successful move the old path is gone, so a second run
 *     hits the "neither / new-only" branch and stays silent.
 *   - lock safety: refuse to move ~/.memoark while a legacy daemon lock is live
 *     (lifecycle.lock / managed-pg.lock with an alive pid).
 *   - backups (~/.memoark.bak.*) are intentionally left untouched.
 *   - legacy MEMOARK_* env vars are NOT honored (clean cut) but never silently
 *     ignored — we warn listing which are set and their MEMKIN_* replacement.
 *
 * All output goes through caller-supplied `notice` / `warn` sinks. In production
 * both default to STDERR (console.error). This is deliberate: the choke point
 * runs for every command including `serve --mcp`, where STDOUT is the JSON-RPC
 * channel and any stray byte corrupts the transport. stderr is safe there.
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export interface MigrateLegacyOptions {
  /** Home directory (injected for tests). */
  home: string;
  /** Current working directory to scan for config + project state (injected for tests). */
  cwd: string;
  /** Environment map to scan for legacy MEMOARK_* vars. */
  env: Record<string, string | undefined>;
  /** Sink for success notices. Defaults to stderr. */
  notice?: (message: string) => void;
  /** Sink for warnings. Defaults to stderr. */
  warn?: (message: string) => void;
}

/** A single directory/file migration target (old path → new path). */
interface MigrationTarget {
  oldPath: string;
  newPath: string;
  /** Human-facing short names for messages, e.g. "~/.memoark". */
  oldLabel: string;
  newLabel: string;
}

/**
 * Check if a process is alive using signal 0 (no actual signal delivered).
 * Mirrors the logic in lifecycle-lock.ts / managed-lock.ts.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // delivered → alive
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true; // exists, owned by another user
    return false; // ESRCH → no such process
  }
}

/**
 * Returns true if the legacy data dir contains a lock file whose owning pid is
 * still alive — i.e. a legacy daemon (serve / managed PG) may be running against
 * it. We refuse to move the dir out from under a live process.
 *
 * We check the same lock filenames the current code uses inside the data dir:
 *   - lifecycle.lock  (SP4 mutation lock; JSON { pid, ... })
 *   - managed-pg.lock (managed Postgres lock; JSON { pid, ts })
 * A corrupted / unparseable lock is treated as NOT live (stale) — consistent
 * with how acquireLifecycleLock / withManagedLock reclaim corrupted locks.
 */
function legacyDataDirHasLiveLock(dir: string): boolean {
  for (const name of ["lifecycle.lock", "managed-pg.lock"]) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as { pid?: unknown };
      const pid = parsed.pid;
      if (typeof pid === "number" && isProcessAlive(pid)) return true;
    } catch {
      // unparseable → treat as stale, keep checking other lock files
    }
  }
  return false;
}

/** Migrate one target with the shared old/new rules (see module doc). */
function migrateTarget(
  target: MigrationTarget,
  notice: (m: string) => void,
  warn: (m: string) => void,
): void {
  const { oldPath, newPath, oldLabel, newLabel } = target;

  const oldExists = existsSync(oldPath);
  const newExists = existsSync(newPath);

  // neither → silent no-op (also the idempotent second-run path once old is gone)
  if (!oldExists) return;

  // both exist → NEVER merge, NEVER delete. Use new, warn once about the stale old one.
  if (newExists) {
    warn(
      `Legacy ${oldLabel} still exists but ${newLabel} is already in use — ` +
        `ignoring the old one. Remove ${oldLabel} manually once you've confirmed nothing is needed.`,
    );
    return;
  }

  // old exists, new absent → rename (same-volume move; atomic, no copy).
  try {
    renameSync(oldPath, newPath);
    notice(`Migrated legacy ${oldLabel} → ${newLabel}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const hint =
      code === "EXDEV" ? " (old and new are on different volumes)" : code ? ` (${code})` : "";
    warn(
      `Could not migrate legacy ${oldLabel} → ${newLabel}${hint}. ` +
        `Move it manually: mv "${oldPath}" "${newPath}"`,
    );
  }
}

/**
 * Detect legacy MEMOARK_* env vars and warn (once) that they are no longer
 * honored and must be renamed to MEMKIN_*. Values are never printed.
 */
function warnLegacyEnvVars(
  env: Record<string, string | undefined>,
  warn: (m: string) => void,
): void {
  const legacy = Object.keys(env)
    .filter((k) => k.startsWith("MEMOARK_"))
    .sort();
  if (legacy.length === 0) return;
  const renamed = legacy.map((k) => `${k}→${k.replace(/^MEMOARK_/, "MEMKIN_")}`).join(", ");
  warn(
    `Ignoring legacy environment variable(s): ${renamed}. ` +
      `MEMOARK_* vars are no longer read — rename them to MEMKIN_* to take effect.`,
  );
}

/**
 * Run all legacy → memkin migrations. Idempotent and safe to call on every boot.
 *
 * Order: env warning first (cheap, always relevant), then data dir (guarded by
 * lock check), then config file, then project state dir.
 */
export function migrateLegacyData(opts: MigrateLegacyOptions): void {
  const notice = opts.notice ?? ((m: string) => console.error(m));
  const warn = opts.warn ?? ((m: string) => console.error(m));
  const { home, cwd, env } = opts;

  // 0. Legacy env vars — warn but do not honor.
  warnLegacyEnvVars(env, warn);

  // 1. User data dir: ~/.memoark → ~/.memkin (lock-guarded).
  const oldDataDir = join(home, ".memoark");
  const newDataDir = join(home, ".memkin");
  if (existsSync(oldDataDir) && !existsSync(newDataDir)) {
    if (legacyDataDirHasLiveLock(oldDataDir)) {
      warn(
        `Legacy data dir ${join(home, ".memoark")} appears to have a running instance ` +
          `(live lock detected). Stop it first (e.g. \`memkin down\`), then re-run to migrate.`,
      );
    } else {
      migrateTarget(
        {
          oldPath: oldDataDir,
          newPath: newDataDir,
          oldLabel: "~/.memoark",
          newLabel: "~/.memkin",
        },
        notice,
        warn,
      );
    }
  } else if (existsSync(oldDataDir) && existsSync(newDataDir)) {
    // both exist → warn once, keep both.
    migrateTarget(
      { oldPath: oldDataDir, newPath: newDataDir, oldLabel: "~/.memoark", newLabel: "~/.memkin" },
      notice,
      warn,
    );
  }

  // 2. Config file: memoark.yaml → memkin.yaml in cwd (default name only; a
  //    user-supplied --config / MEMKIN_CONFIG path is their own and untouched).
  migrateTarget(
    {
      oldPath: join(cwd, "memoark.yaml"),
      newPath: join(cwd, "memkin.yaml"),
      oldLabel: "memoark.yaml",
      newLabel: "memkin.yaml",
    },
    notice,
    warn,
  );

  // 3. Project-local state dir: ./.memoark → ./.memkin in cwd.
  migrateTarget(
    {
      oldPath: join(cwd, ".memoark"),
      newPath: join(cwd, ".memkin"),
      oldLabel: "./.memoark",
      newLabel: "./.memkin",
    },
    notice,
    warn,
  );
}
