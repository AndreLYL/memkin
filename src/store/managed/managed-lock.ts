import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_TIMEOUT_MS = 10_000;
const RETRY_INTERVAL_MS = 25;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EPERM") return true; // process exists, no permission to signal
    if (e.code === "ESRCH") return false; // no such process
    return false;
  }
}

export async function withManagedLock<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = join(home, ".memoark");
  const lockPath = join(lockDir, "managed-pg.lock");
  const content = JSON.stringify({ pid: process.pid, ts: Date.now() });

  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    mkdirSync(lockDir, { recursive: true });

    try {
      writeFileSync(lockPath, content, { flag: "wx" });
      // Lock acquired
      break;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw e;

      // Lock file exists — read it to decide what to do
      let existing: { pid?: number; ts?: number } = {};
      try {
        existing = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        // Unparseable lock → stale, remove and retry
        rmSync(lockPath, { force: true });
        continue;
      }

      const ownerPid = existing.pid;
      if (typeof ownerPid !== "number" || !isProcessAlive(ownerPid)) {
        // Dead owner or missing pid → stale, remove and retry
        rmSync(lockPath, { force: true });
        continue;
      }

      // Live owner → wait and retry (handles both cross-process and same-process serialization)
      if (Date.now() >= deadline) {
        throw new Error(`could not acquire managed-pg.lock (held by pid ${ownerPid})`);
      }
      await delay(RETRY_INTERVAL_MS);
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}
