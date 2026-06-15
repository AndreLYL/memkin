import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, DataDirLockError } from "./data-dir-lock.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memoark-lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("acquireLock", () => {
  it("在空目录获取锁,写出含正确字段的锁文件", () => {
    const handle = acquireLock(dir, "test-cmd");
    const lockPath = join(dir, "memoark.lock");
    expect(existsSync(lockPath)).toBe(true);
    const info = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(info.pid).toBe(process.pid);
    expect(info.command).toBe("test-cmd");
    expect(typeof info.hostname).toBe("string");
    expect(typeof info.startedAt).toBe("string");
    handle.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("活进程持锁时,二次 acquire 抛 DataDirLockError 且 holder 正确(含同进程二次 open)", () => {
    const first = acquireLock(dir, "holder-cmd");
    try {
      expect(() => acquireLock(dir, "second-cmd")).toThrowError(DataDirLockError);
      try {
        acquireLock(dir, "second-cmd");
      } catch (err) {
        expect(err).toBeInstanceOf(DataDirLockError);
        expect((err as DataDirLockError).holder.pid).toBe(process.pid);
        expect((err as DataDirLockError).holder.command).toBe("holder-cmd");
      }
    } finally {
      first.release();
    }
  });

  it("死 pid 的 stale 锁被抢占成功", () => {
    const lockPath = join(dir, "memoark.lock");
    const stale = { pid: 999999, command: "dead", hostname: hostname(), startedAt: "2020-01-01T00:00:00.000Z" };
    writeFileSync(lockPath, JSON.stringify(stale));
    const handle = acquireLock(dir, "winner");
    const info = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(info.pid).toBe(process.pid);
    expect(info.command).toBe("winner");
    handle.release();
  });

  it("损坏的锁文件被视为 stale 并抢占", () => {
    const lockPath = join(dir, "memoark.lock");
    writeFileSync(lockPath, "{ this is not json");
    const handle = acquireLock(dir, "winner");
    const info = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(info.pid).toBe(process.pid);
    handle.release();
  });

  it("不同 hostname 的锁即使 pid 死也保守拒绝", () => {
    const lockPath = join(dir, "memoark.lock");
    const other = { pid: 999999, command: "remote", hostname: "some-other-host", startedAt: "2020-01-01T00:00:00.000Z" };
    writeFileSync(lockPath, JSON.stringify(other));
    expect(() => acquireLock(dir, "local")).toThrowError(DataDirLockError);
  });

  it("release 幂等;不删别的进程持有的锁", () => {
    const handle = acquireLock(dir, "me");
    const lockPath = join(dir, "memoark.lock");
    handle.release();
    expect(existsSync(lockPath)).toBe(false);
    expect(() => handle.release()).not.toThrow();

    const handle2 = acquireLock(dir, "me2");
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, command: "other", hostname: "h", startedAt: "x" }));
    handle2.release();
    expect(existsSync(lockPath)).toBe(true);
    rmSync(lockPath, { force: true });
  });

  it("抢占 stale 锁后,结果是唯一独占持有者", () => {
    const lockPath = join(dir, "memoark.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, command: "dead", hostname: hostname(), startedAt: "2020-01-01T00:00:00.000Z" }));
    const winner = acquireLock(dir, "winner");
    expect(() => acquireLock(dir, "loser")).toThrowError(DataDirLockError);
    winner.release();
  });
});
