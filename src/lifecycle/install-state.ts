import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface OpRef {
  client: string;
  scope: "global" | "project";
  path: string;
  op_kind: string;
}

export interface OriginalEntry {
  present: boolean;
  raw: string | null;
}

export interface InstallStateOp extends OpRef {
  original: OriginalEntry;
  managed_hash: string;
}

export interface InstallState {
  ops: InstallStateOp[];
}

/** Composite key identifying a unique operation. */
export function opKey(op: OpRef): string {
  return `${op.client}|${op.scope}|${op.path}|${op.op_kind}`;
}

function stateFilePath(home: string): string {
  return join(home, ".memoark", "install-state.json");
}

/** Read persisted install state. Returns `{ ops: [] }` when the file is absent or unreadable. */
export function readInstallState(home: string): InstallState {
  const filePath = stateFilePath(home);
  if (!existsSync(filePath)) return { ops: [] };
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as InstallState;
  } catch {
    return { ops: [] };
  }
}

/** Atomically write install state to disk (temp + rename, mode 600). */
function writeInstallState(home: string, state: InstallState): void {
  const stateDir = join(home, ".memoark");
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  const filePath = stateFilePath(home);
  const tmpPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;

  writeFileSync(tmpPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmpPath, filePath);
}

/**
 * Record the original state of an op before memoark mutates it.
 *
 * First-backup-wins: if the op key already exists, `original` is NOT overwritten.
 * `managed_hash` is always updated to the latest written value.
 */
export function recordOriginal(
  home: string,
  op: OpRef,
  original: OriginalEntry,
  managedHash: string,
): void {
  const state = readInstallState(home);
  const key = opKey(op);
  const existing = state.ops.find((o) => opKey(o) === key);

  if (existing) {
    // First-backup-wins: keep existing original; update managed_hash only
    existing.managed_hash = managedHash;
  } else {
    state.ops.push({
      ...op,
      original,
      managed_hash: managedHash,
    });
  }

  writeInstallState(home, state);
}

/**
 * Return the stored original ONLY if `stored.managed_hash === currentHash`.
 * Returns `null` when the op has no record, or when hashes diverge (user hand-edited).
 */
export function restorableOriginal(
  home: string,
  op: OpRef,
  currentHash: string,
): OriginalEntry | null {
  const state = readInstallState(home);
  const key = opKey(op);
  const stored = state.ops.find((o) => opKey(o) === key);

  if (!stored) return null;
  if (stored.managed_hash !== currentHash) return null;

  return stored.original;
}
