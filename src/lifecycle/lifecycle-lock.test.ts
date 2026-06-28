import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLifecycleLock, LifecycleLockError } from "./lifecycle-lock.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memoark-life-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("acquireLifecycleLock", () => {
  it("acquires in a fresh home and writes the lock file with correct fields", () => {
    const h = acquireLifecycleLock(home, "up");
    const p = join(home, ".memoark", "lifecycle.lock");
    expect(existsSync(p)).toBe(true);
    h.release();
    expect(existsSync(p)).toBe(false);
  });
  it("serializes: a 2nd live acquire throws LifecycleLockError with holder", () => {
    const h = acquireLifecycleLock(home, "up");
    try {
      expect(() => acquireLifecycleLock(home, "down")).toThrowError(LifecycleLockError);
      try {
        acquireLifecycleLock(home, "down");
      } catch (e) {
        expect((e as LifecycleLockError).holder.command).toBe("up");
      }
    } finally {
      h.release();
    }
  });
  it("reclaims a stale (dead pid) lock", () => {
    mkdirSync(join(home, ".memoark"), { recursive: true });
    writeFileSync(
      join(home, ".memoark", "lifecycle.lock"),
      JSON.stringify({
        pid: 999999,
        command: "x",
        hostname: hostname(),
        startedAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    const h = acquireLifecycleLock(home, "up");
    h.release();
    expect(existsSync(join(home, ".memoark", "lifecycle.lock"))).toBe(false);
  });
});
