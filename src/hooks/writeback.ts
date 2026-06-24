import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Opt-in, debounced, non-blocking auto write-back for the SessionEnd hook.
// When enabled, triggers a detached `memoark extract --source claude-code`
// (incremental + deduped + L1/L2 noise-filtered) at most once per debounce window.

const DEFAULT_DEBOUNCE_MS = 10 * 60 * 1000; // 10 minutes

function stampPath(home: string): string {
  return join(home, ".memoark", ".last-writeback");
}

function defaultReadStamp(home: string): number | null {
  const p = stampPath(home);
  if (!existsSync(p)) return null;
  const n = Number(readFileSync(p, "utf8").trim());
  return Number.isFinite(n) ? n : null;
}

function defaultWriteStamp(home: string, t: number): void {
  try {
    writeFileSync(stampPath(home), String(t));
  } catch {
    // best-effort; a missing ~/.memoark just means no debounce persistence
  }
}

function defaultSpawn(): void {
  const child = spawn("memoark", ["extract", "--source", "claude-code"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export interface WritebackDeps {
  enabled: boolean;
  debounceMs?: number;
  home?: string;
  now?: number;
  readStamp?: () => number | null;
  writeStamp?: (t: number) => void;
  spawnExtract?: () => void;
}

/** Returns true if a write-back was triggered. Never blocks (extract is detached). */
export function runWriteback(deps: WritebackDeps): boolean {
  if (!deps.enabled) return false;
  const home = deps.home ?? homedir();
  const now = deps.now ?? Date.now();
  const debounce = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const last = (deps.readStamp ?? (() => defaultReadStamp(home)))();
  if (last !== null && now - last < debounce) return false;
  (deps.writeStamp ?? ((t) => defaultWriteStamp(home, t)))(now);
  (deps.spawnExtract ?? defaultSpawn)();
  return true;
}
