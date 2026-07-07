/**
 * Legacy data auto-migration (R2): memoark → memkin.
 *
 * R1 renamed every default with NO fallback (config file, ~/.memkin data dir,
 * project-local .memkin/ state dir). Existing users — whose real memories live
 * under the old memoark paths — would silently start from scratch. This module
 * performs a one-shot, seamless migration at CLI startup so nothing is lost.
 *
 * It is invoked ONCE, early in CLI boot (a commander `preAction` hook), BEFORE
 * loadConfig reads memkin.yaml or any store is opened. It covers three moves
 * plus one rewrite:
 *
 *   1. user data dir   ~/.memoark      → ~/.memkin
 *   2. config file      memoark.yaml   → memkin.yaml   (nearest-ancestor search,
 *      mirroring resolveConfigPath's upward walk from cwd)
 *   3. project state    .memoark/      → .memkin/      (at the config anchor dir
 *      AND at cwd — see migrateLegacyData for why both)
 *   4. daemon.json      config_path rewritten when it still references a legacy
 *      memoark path that steps 1–2 renamed out from under it
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

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

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
  /** Rename primitive (injected for tests, e.g. to simulate EXDEV). Defaults to fs.renameSync. */
  renameFn?: (oldPath: string, newPath: string) => void;
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
  renameFn: (oldPath: string, newPath: string) => void,
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
    renameFn(oldPath, newPath);
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
 * Find the directory where config discovery will anchor, mirroring
 * resolveConfigPath (src/core/config.ts): walk up from cwd and stop at the
 * FIRST directory containing memkin.yaml OR memoark.yaml.
 *
 * Including the legacy name in the stop condition is the whole point: a user
 * with memoark.yaml at the project root who runs memkin from a subdir must get
 * that file renamed IN PLACE at the ancestor, or post-R1 discovery walks past
 * it and silently boots on defaults. A nearer memkin.yaml shadows any older
 * memoark.yaml higher up (exactly as discovery would), so we stop there and
 * leave the shadowed file alone.
 *
 * Falls back to cwd when nothing is found — same as resolveConfigPath's
 * `resolve(process.cwd(), "memkin.yaml")` fallback.
 */
function findConfigAnchorDir(cwd: string): string {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, "memkin.yaml")) || existsSync(join(dir, "memoark.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
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
 * 4. daemon.json config_path rewrite. Steps 1–2 can rename the very file that
 * ~/.memkin/daemon.json's `config_path` points at (the step-1 dir rename even
 * moves daemon.json itself, keeping the stale path inside). A daemon relaunch
 * would then boot `serve` against a nonexistent config. Rewrite the entry to
 * its migrated counterpart when — and only when — all of these hold:
 *   - config_path references a legacy name (a `.memoark` path segment or a
 *     `memoark.yaml` basename); anything else is not migration's business,
 *   - the file it points at no longer exists (a still-valid path, e.g. the
 *     kept old dir in the both-exist case, is left alone),
 *   - a migrated counterpart actually exists on disk (otherwise rewriting just
 *     swaps one dangling path for another — serve's read-time self-heal
 *     covers that case).
 * Corrupt / unreadable daemon.json is skipped silently. Idempotent: after the
 * rewrite config_path exists, so a second run stops at the exists check.
 */
function migrateDaemonConfigPath(home: string, notice: (m: string) => void): void {
  const daemonJsonPath = join(home, ".memkin", "daemon.json");
  if (!existsSync(daemonJsonPath)) return;

  let state: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(daemonJsonPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
    state = parsed as Record<string, unknown>;
  } catch {
    return; // corrupt → leave untouched; readDaemonState treats it as absent anyway
  }

  const configPath = state.config_path;
  if (typeof configPath !== "string" || configPath.length === 0) return;

  const hasLegacySegment = configPath.split(sep).includes(".memoark");
  const hasLegacyBasename = basename(configPath) === "memoark.yaml";
  if (!hasLegacySegment && !hasLegacyBasename) return;
  if (existsSync(configPath)) return;

  // Candidates mirror the step 1–3 renames. The dir swap alone comes first: the
  // step-1 wholesale dir move keeps filenames as-is, so ~/.memoark/memoark.yaml
  // lands at ~/.memkin/memoark.yaml (old NAME inside the moved dir).
  const dirSwap = (p: string): string =>
    p
      .split(sep)
      .map((seg) => (seg === ".memoark" ? ".memkin" : seg))
      .join(sep);
  const baseSwap = (p: string): string =>
    basename(p) === "memoark.yaml" ? join(dirname(p), "memkin.yaml") : p;

  const candidates = [dirSwap(configPath), baseSwap(dirSwap(configPath)), baseSwap(configPath)];
  const replacement = candidates.find((c) => c !== configPath && existsSync(c));
  if (!replacement) return;

  try {
    writeFileSync(
      daemonJsonPath,
      JSON.stringify({ ...state, config_path: replacement }, null, 2),
      "utf8",
    );
    notice(`Migrated daemon.json config_path → ${replacement}`);
  } catch {
    // best-effort: serve's read-time self-heal is the fallback
  }
}

/**
 * Run all legacy → memkin migrations. Idempotent and safe to call on every boot.
 *
 * Order: env warning first (cheap, always relevant), then data dir (guarded by
 * lock check), then config file, then project state dir, then the daemon.json
 * config_path rewrite (last — it must observe the results of steps 1–3).
 */
export function migrateLegacyData(opts: MigrateLegacyOptions): void {
  const notice = opts.notice ?? ((m: string) => console.error(m));
  const warn = opts.warn ?? ((m: string) => console.error(m));
  const renameFn = opts.renameFn ?? renameSync;
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
        renameFn,
      );
    }
  } else if (existsSync(oldDataDir) && existsSync(newDataDir)) {
    // both exist → warn once, keep both.
    migrateTarget(
      { oldPath: oldDataDir, newPath: newDataDir, oldLabel: "~/.memoark", newLabel: "~/.memkin" },
      notice,
      warn,
      renameFn,
    );
  }

  // 2. Config file: memoark.yaml → memkin.yaml at the discovery anchor (nearest
  //    ancestor from cwd, mirroring resolveConfigPath's upward walk — NOT just
  //    cwd, or a config at the project root is missed when running from a
  //    subdir). Default name only; a user-supplied --config / MEMKIN_CONFIG
  //    path is their own and untouched.
  const anchorDir = findConfigAnchorDir(cwd);
  const inAnchor = anchorDir === cwd ? "" : ` (in ${anchorDir})`;
  migrateTarget(
    {
      oldPath: join(anchorDir, "memoark.yaml"),
      newPath: join(anchorDir, "memkin.yaml"),
      oldLabel: `memoark.yaml${inAnchor}`,
      newLabel: "memkin.yaml",
    },
    notice,
    warn,
    renameFn,
  );

  // 3. Project-local state dir: .memoark/ → .memkin/. State resolution is NOT
  //    cwd-only (src/core/state.ts defaults to cwd, but most call sites anchor
  //    to the config's projectRoot = dirname(configPath) — e.g. extract/serve in
  //    cli.ts), so migrate at BOTH locations: the config anchor dir (projectRoot
  //    callers) and cwd (no-base callers like `docs sync`). Same rules each.
  const stateDirs = anchorDir === cwd ? [cwd] : [anchorDir, cwd];
  for (const base of stateDirs) {
    const inBase = base === cwd ? "" : ` (in ${base})`;
    migrateTarget(
      {
        oldPath: join(base, ".memoark"),
        newPath: join(base, ".memkin"),
        oldLabel: `.memoark/${inBase}`,
        newLabel: ".memkin/",
      },
      notice,
      warn,
      renameFn,
    );
  }

  // 4. daemon.json config_path: rewrite legacy references invalidated by steps 1–2.
  migrateDaemonConfigPath(home, notice);
}
