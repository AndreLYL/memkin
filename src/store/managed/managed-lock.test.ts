import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withManagedLock } from "./managed-lock.js";

let home: string;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "mk-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("managed-lock", () => {
  it("serializes concurrent critical sections", async () => {
    const order: string[] = [];
    const a = withManagedLock(home, async () => { order.push("a-in"); await delay(30); order.push("a-out"); });
    const b = withManagedLock(home, async () => { order.push("b-in"); order.push("b-out"); });
    await Promise.all([a, b]);
    // b must not interleave inside a
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out"]);
  });

  it("returns the callback result and releases the lock", async () => {
    const r = await withManagedLock(home, async () => "ok");
    expect(r).toBe("ok");
    // a subsequent call still works (lock was released)
    expect(await withManagedLock(home, async () => 42)).toBe(42);
  });

  it("breaks a stale lock whose owner pid is gone", async () => {
    mkdirSync(join(home, ".memoark"), { recursive: true });
    // pid 2147483647 is effectively guaranteed not to exist
    writeFileSync(join(home, ".memoark", "managed-pg.lock"), JSON.stringify({ pid: 2147483647, ts: 0 }), "utf8");
    await expect(withManagedLock(home, async () => "took-over")).resolves.toBe("took-over");
  });

  it("releases the lock even if the callback throws", async () => {
    await expect(withManagedLock(home, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withManagedLock(home, async () => "recovered")).toBe("recovered");
  });
});
