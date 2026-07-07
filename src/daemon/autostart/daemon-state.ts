import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DaemonState {
  instance_id: string;
  config_path: string;
  raw_yaml_hash: string;
  serving_subset_hash: string;
  url: string;
  argv: string[];
}

export interface ServingSubset {
  bind: string;
  port: number;
  readOnly: boolean;
  hosts: string[];
}

export function writeDaemonState(dir: string, state: DaemonState): void {
  const filePath = join(dir, "daemon.json");
  const tmpPath = join(dir, "daemon.json.tmp");
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

export function readDaemonState(dir: string): DaemonState | null {
  const filePath = join(dir, "daemon.json");
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as DaemonState;
  } catch {
    return null;
  }
}

export interface RecoverServeConfigPathOptions {
  /** The config path serve was asked to boot on (explicit --config or the cwd default) — known missing. */
  requestedPath: string;
  /** Directory holding daemon.json (~/.memkin). */
  stateDir: string;
  /**
   * True only for a daemon-launched serve (--daemon-instance-id present). The
   * frozen plist/unit argv can carry a stale --config forever, while daemon.json
   * is kept current by migration — so for daemon relaunches it is the
   * authoritative recovery source, and a stale entry is healed in place.
   * Interactive serves never consult it (a --config typo is the user's own).
   */
  trustDaemonState: boolean;
  /** Normal config discovery fallback (resolveConfigPath's upward walk). */
  discover: () => string;
}

export interface RecoveredServeConfig {
  configPath: string;
  source: "daemon-state" | "discovered";
  /** True when a stale daemon.json config_path was rewritten to the recovered value. */
  healedDaemonState: boolean;
}

/**
 * F1 serve self-heal: called when the config path serve was launched with does
 * not exist (e.g. the memoark → memkin rename moved it out from under a frozen
 * daemon argv). Recovery order: daemon.json's config_path (daemon-launched serve
 * only), then normal discovery. When discovery rescues a daemon-launched serve
 * whose daemon.json entry is stale, the corrected path is written back so the
 * next relaunch recovers without the fallback. Returns null when nothing on
 * disk can be found — the caller keeps its fatal "no configuration" path.
 */
export function recoverServeConfigPath(
  opts: RecoverServeConfigPathOptions,
): RecoveredServeConfig | null {
  const state = opts.trustDaemonState ? readDaemonState(opts.stateDir) : null;

  if (state && typeof state.config_path === "string" && existsSync(state.config_path)) {
    return { configPath: state.config_path, source: "daemon-state", healedDaemonState: false };
  }

  const discovered = opts.discover();
  if (!existsSync(discovered)) return null;

  let healedDaemonState = false;
  if (state) {
    // daemon.json exists but its config_path is stale — heal it in place,
    // preserving every other field.
    writeDaemonState(opts.stateDir, { ...state, config_path: discovered });
    healedDaemonState = true;
  }
  return { configPath: discovered, source: "discovered", healedDaemonState };
}

export function rawYamlHash(filePath: string): string {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function servingSubsetHash(subset: ServingSubset): string {
  const normalized: ServingSubset = {
    ...subset,
    hosts: [...subset.hosts].sort(),
  };
  const sorted = Object.fromEntries(
    Object.keys(normalized)
      .sort()
      .map((k) => [k, normalized[k as keyof ServingSubset]]),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
