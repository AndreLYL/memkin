import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withManagedLock } from "./managed-lock.js";

let home: string;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mk-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("managed-lock", () => {
  it("serializes concurrent critical sections", async () => {
    const order: string[] = [];
    const a = withManagedLock(home, async () => {
      order.push("a-in");
      await delay(30);
      order.push("a-out");
    });
    const b = withManagedLock(home, async () => {
      order.push("b-in");
      order.push("b-out");
    });
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
    writeFileSync(
      join(home, ".memoark", "managed-pg.lock"),
      JSON.stringify({ pid: 2147483647, ts: 0 }),
      "utf8",
    );
    await expect(withManagedLock(home, async () => "took-over")).resolves.toBe("took-over");
  });

  it("releases the lock even if the callback throws", async () => {
    await expect(
      withManagedLock(home, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await withManagedLock(home, async () => "recovered")).toBe("recovered");
  });

  it("waits on a live same-pid lock instead of stealing it", async () => {
    const events: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    // hold the lock with a long-running callback
    const holder = withManagedLock(home, async () => {
      events.push("held");
      await held;
      events.push("released");
    });
    // give the holder time to acquire
    await delay(20);
    const waiter = withManagedLock(home, async () => {
      events.push("waiter-ran");
    });
    // waiter must not run yet — lock is held by a live owner (same process, same pid)
    await delay(20);
    expect(events).toEqual(["held"]); // waiter still blocked, lock not stolen
    release();
    await Promise.all([holder, waiter]);
    expect(events).toEqual(["held", "released", "waiter-ran"]);
  });
});
