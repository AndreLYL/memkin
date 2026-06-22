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

const LOCK_FILENAME = "memoark.lock";
const MAX_PREEMPT_RETRIES = 5;

function formatLockError(h: LockInfo): string {
  return [
    "✗ Memoark 已在运行(另一个进程持有数据库锁)",
    `  持有者: PID ${h.pid}, 命令 '${h.command}', 启动于 ${h.startedAt} (host: ${h.hostname})`,
    "  data_dir 同时只能被一个进程访问(PGLite 限制)。",
    "  → 先停掉那个进程,或改用 serve 的 HTTP API。",
    "  → 确认是残留锁?设 MEMOARK_NO_LOCK=1 强制跳过。",
  ].join("\n");
}

export class DataDirLockError extends Error {
  readonly holder: LockInfo;
  constructor(holder: LockInfo) {
    super(formatLockError(holder));
    this.name = "DataDirLockError";
    this.holder = holder;
  }
}

/** 进程是否存活:signal 0 不实际发信号,只做存在性/权限探测。 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // 投递成功 → 存活
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true; // 存在但属别的用户
    return false; // ESRCH → 无此进程
  }
}

function makeHandle(lockPath: string, self: LockInfo): LockHandle {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const cur = JSON.parse(readFileSync(lockPath, "utf8")) as LockInfo;
      if (cur.pid === self.pid) unlinkSync(lockPath); // 只删自己持有的
    } catch {
      // 已删 / 损坏 → 无需处理
    }
    process.removeListener("exit", release);
  };
  process.once("exit", release);
  return { release };
}

export function acquireLock(dataDir: string, command: string): LockHandle {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dataDir, LOCK_FILENAME);
  const self: LockInfo = {
    pid: process.pid,
    command,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < MAX_PREEMPT_RETRIES; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(self), { flag: "wx" }); // O_EXCL 原子创建
      return makeHandle(lockPath, self);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    // EEXIST → 检查当前持有者
    let holder: LockInfo | null = null;
    try {
      holder = JSON.parse(readFileSync(lockPath, "utf8")) as LockInfo;
    } catch {
      holder = null; // 锁文件损坏 → 视为 stale
    }
    if (holder && holder.hostname !== self.hostname) throw new DataDirLockError(holder); // 跨 host 保守拒绝
    if (holder && isProcessAlive(holder.pid)) throw new DataDirLockError(holder); // 活进程 → 拒绝
    // stale(死 pid / 损坏)→ 原子抢占:unlink 后回到循环重试 wx
    try {
      unlinkSync(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // 别的进程已抢先删
    }
  }
  throw new Error(
    `Failed to acquire data_dir lock after ${MAX_PREEMPT_RETRIES} attempts (livelock?)`,
  );
}
