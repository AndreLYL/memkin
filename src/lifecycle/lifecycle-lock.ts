import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export interface LockInfo {
  pid: number;
  command: string;
  hostname: string;
  startedAt: string;
}

export interface LockHandle {
  release(): void;
}

const LOCK_FILENAME = "lifecycle.lock";
const MAX_PREEMPT_RETRIES = 5;

export class LifecycleLockError extends Error {
  readonly holder: LockInfo;
  constructor(holder: LockInfo) {
    super(
      [
        "✗ Memkin lifecycle lock is held by another process",
        `  Holder: PID ${holder.pid}, command '${holder.command}', started at ${holder.startedAt} (host: ${holder.hostname})`,
        "  Only one SP4 mutation command can run at a time.",
        "  → Wait for the other command to finish, then retry.",
      ].join("\n"),
    );
    this.name = "LifecycleLockError";
    this.holder = holder;
  }
}

/** Check if a process is alive using signal 0 (no actual signal sent). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // delivered → alive
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true; // exists but owned by another user
    return false; // ESRCH → no such process
  }
}

function makeHandle(lockPath: string, self: LockInfo): LockHandle {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const cur = JSON.parse(readFileSync(lockPath, "utf8")) as LockInfo;
      if (cur.pid === self.pid) unlinkSync(lockPath); // only delete if we still own it
    } catch {
      // already deleted or corrupted → nothing to do
    }
    process.removeListener("exit", release);
  };
  process.once("exit", release);
  return { release };
}

/**
 * Acquire the lifecycle advisory lock at `<home>/.memkin/lifecycle.lock`.
 * Throws `LifecycleLockError` if another live process on this hostname holds the lock.
 * Reclaims stale locks (dead pid).
 */
export function acquireLifecycleLock(home: string, command: string): LockHandle {
  const lockDir = join(home, ".memkin");
  if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });

  const lockPath = join(lockDir, LOCK_FILENAME);
  const self: LockInfo = {
    pid: process.pid,
    command,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < MAX_PREEMPT_RETRIES; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(self), { flag: "wx" }); // O_EXCL — atomic create
      return makeHandle(lockPath, self);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    // EEXIST — inspect current holder
    let holder: LockInfo | null = null;
    try {
      holder = JSON.parse(readFileSync(lockPath, "utf8")) as LockInfo;
    } catch {
      holder = null; // corrupted → treat as stale
    }

    if (holder && holder.hostname !== self.hostname) throw new LifecycleLockError(holder); // cross-host: conservative reject
    if (holder && isProcessAlive(holder.pid)) throw new LifecycleLockError(holder); // live process → reject

    // stale (dead pid or corrupted) — unlink and retry
    try {
      unlinkSync(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // another process already cleaned up
    }
  }

  throw new Error(
    `Failed to acquire lifecycle lock after ${MAX_PREEMPT_RETRIES} attempts (livelock?)`,
  );
}
