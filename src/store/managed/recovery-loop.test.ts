import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRecoveryLoop } from "./recovery-loop.js";
import type { RecoveryLoopOptions, RecoveryTarget } from "./recovery-loop.js";

/**
 * All tests use vi.useFakeTimers() to drive the self-rescheduling setTimeout loop
 * deterministically. vi.advanceTimersByTimeAsync(ms) is used to tick the clock and
 * await any microtasks (promise resolutions) that fall within that window.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── helpers ───────────────────────────────────────────────────────────────

function makeTarget(
  impl: () => Promise<boolean>,
): RecoveryTarget & { calls: number } {
  const t = {
    calls: 0,
    restartIfDown: async () => {
      t.calls++;
      return impl();
    },
  };
  return t;
}

// ─── 1. periodic calls ─────────────────────────────────────────────────────

describe("periodic restartIfDown calls", () => {
  it("calls restartIfDown once per intervalMs across 3 intervals", async () => {
    const target = makeTarget(async () => false);
    const handle = startRecoveryLoop(target, { intervalMs: 1000 });

    // Tick 3 full intervals
    await vi.advanceTimersByTimeAsync(3100);

    expect(target.calls).toBe(3);
    handle.stop();
  });
});

// ─── 2. single-flight ──────────────────────────────────────────────────────

describe("single-flight (no overlap)", () => {
  it("does not start a second check while the first is still pending", async () => {
    let resolveFirst!: (v: boolean) => void;
    const firstPromise = new Promise<boolean>((res) => {
      resolveFirst = res;
    });

    const target = makeTarget(() => firstPromise);
    const handle = startRecoveryLoop(target, { intervalMs: 500 });

    // Advance well past several intervals — the first call is still pending
    await vi.advanceTimersByTimeAsync(2500);

    // Should still be only 1 call because we self-reschedule AFTER resolution
    expect(target.calls).toBe(1);

    // Now resolve the first promise and let the next tick schedule
    resolveFirst(false);
    await vi.advanceTimersByTimeAsync(600);

    // Should now be exactly 2 calls (first + one more after resolution)
    expect(target.calls).toBe(2);

    handle.stop();
  });
});

// ─── 3. onRestart fired ────────────────────────────────────────────────────

describe("onRestart callback", () => {
  it("fires onRestart when restartIfDown returns true", async () => {
    const restartEvents: { attempt: number }[] = [];
    const opts: RecoveryLoopOptions = {
      intervalMs: 1000,
      onRestart: (info) => restartEvents.push({ ...info }),
    };

    const target = makeTarget(async () => true);
    const handle = startRecoveryLoop(target, opts);

    await vi.advanceTimersByTimeAsync(2100);

    expect(restartEvents.length).toBe(2);
    expect(restartEvents[0].attempt).toBeGreaterThanOrEqual(1);
    handle.stop();
  });

  it("does NOT fire onRestart when restartIfDown returns false", async () => {
    const restartEvents: { attempt: number }[] = [];
    const opts: RecoveryLoopOptions = {
      intervalMs: 1000,
      onRestart: (info) => restartEvents.push({ ...info }),
    };

    const target = makeTarget(async () => false);
    const handle = startRecoveryLoop(target, opts);

    await vi.advanceTimersByTimeAsync(2100);

    expect(restartEvents.length).toBe(0);
    handle.stop();
  });
});

// ─── 4. backoff on failure ─────────────────────────────────────────────────

describe("exponential backoff on consecutive failures", () => {
  it("doubles the delay after each failure, capped at maxIntervalMs", async () => {
    const errorEvents: { consecutiveFailures: number }[] = [];
    const opts: RecoveryLoopOptions = {
      intervalMs: 1000,
      maxIntervalMs: 8000,
      maxConsecutiveFailures: 99, // don't trigger fatal in this test
      onError: (_err, cf) => errorEvents.push({ consecutiveFailures: cf }),
    };

    const target = makeTarget(async () => {
      throw new Error("pg down");
    });
    const handle = startRecoveryLoop(target, opts);

    // Failure 1: fires at t=1000, next delay=1000 (2^0 * 1000 = 1000)
    await vi.advanceTimersByTimeAsync(1050);
    expect(target.calls).toBe(1);
    expect(errorEvents[0]?.consecutiveFailures).toBe(1);

    // Failure 2: fires at t=2050, next delay=2000 (2^1)
    await vi.advanceTimersByTimeAsync(1050);
    expect(target.calls).toBe(2);
    expect(errorEvents[1]?.consecutiveFailures).toBe(2);

    // Failure 3: fires at t=4050, next delay=4000 (2^2)
    await vi.advanceTimersByTimeAsync(2050);
    expect(target.calls).toBe(3);
    expect(errorEvents[2]?.consecutiveFailures).toBe(3);

    // Failure 4: fires at t=8050, next delay=8000 (2^3, capped at maxIntervalMs)
    await vi.advanceTimersByTimeAsync(4050);
    expect(target.calls).toBe(4);
    expect(errorEvents[3]?.consecutiveFailures).toBe(4);

    // Failure 5: fires at t=16050 (8000 cap applied), next delay=8000
    await vi.advanceTimersByTimeAsync(8050);
    expect(target.calls).toBe(5);

    handle.stop();
  });

  it("tracks consecutiveFailures on the handle", async () => {
    const opts: RecoveryLoopOptions = {
      intervalMs: 500,
      maxConsecutiveFailures: 99,
    };

    const target = makeTarget(async () => {
      throw new Error("fail");
    });
    const handle = startRecoveryLoop(target, opts);

    await vi.advanceTimersByTimeAsync(600);
    expect(handle.consecutiveFailures).toBe(1);

    await vi.advanceTimersByTimeAsync(600);
    expect(handle.consecutiveFailures).toBe(2);

    handle.stop();
  });
});

// ─── 5. onFatal ────────────────────────────────────────────────────────────

describe("onFatal callback", () => {
  it("fires onFatal exactly once when consecutiveFailures hits the threshold", async () => {
    const fatalEvents: number[] = [];
    const opts: RecoveryLoopOptions = {
      intervalMs: 500,
      maxIntervalMs: 2000,
      maxConsecutiveFailures: 3,
      onFatal: (cf) => fatalEvents.push(cf),
    };

    const target = makeTarget(async () => {
      throw new Error("pg down");
    });
    const handle = startRecoveryLoop(target, opts);

    // 3 failures: delays 500, 1000, 2000
    // t=500 → failure 1
    await vi.advanceTimersByTimeAsync(550);
    expect(target.calls).toBe(1);
    expect(fatalEvents.length).toBe(0);

    // t=1500 → failure 2 (delay was 1000)
    await vi.advanceTimersByTimeAsync(1050);
    expect(target.calls).toBe(2);
    expect(fatalEvents.length).toBe(0);

    // t=3500 → failure 3 — threshold hit (delay was 2000)
    await vi.advanceTimersByTimeAsync(2050);
    expect(target.calls).toBe(3);
    expect(fatalEvents.length).toBe(1);
    expect(fatalEvents[0]).toBe(3);

    // Additional failures should NOT fire onFatal again
    await vi.advanceTimersByTimeAsync(2100);
    expect(target.calls).toBe(4);
    expect(fatalEvents.length).toBe(1); // still 1, not 2

    handle.stop();
  });

  it("loop keeps running after fatal threshold (loop does not stop)", async () => {
    const opts: RecoveryLoopOptions = {
      intervalMs: 500,
      maxIntervalMs: 1000,
      maxConsecutiveFailures: 2,
      onFatal: () => {
        /* just observe */
      },
    };

    const target = makeTarget(async () => {
      throw new Error("pg down");
    });
    const handle = startRecoveryLoop(target, opts);

    // 2 failures to hit fatal
    await vi.advanceTimersByTimeAsync(600);
    await vi.advanceTimersByTimeAsync(1100);
    expect(target.calls).toBe(2);

    // Loop should keep running at capped interval
    await vi.advanceTimersByTimeAsync(1100);
    expect(target.calls).toBe(3);

    handle.stop();
  });
});

// ─── 6. reset after success ────────────────────────────────────────────────

describe("reset after success", () => {
  it("resets consecutiveFailures to 0 and delay to intervalMs after a successful check", async () => {
    const callTimes: number[] = [];
    let callCount = 0;

    const opts: RecoveryLoopOptions = {
      intervalMs: 1000,
      maxIntervalMs: 8000,
      maxConsecutiveFailures: 99,
    };

    // Fail twice, then succeed
    const target: RecoveryTarget & { calls: number } = {
      calls: 0,
      restartIfDown: async () => {
        target.calls++;
        callCount++;
        callTimes.push(Date.now());
        if (callCount <= 2) {
          throw new Error("fail");
        }
        return false; // success
      },
    };

    const handle = startRecoveryLoop(target, opts);

    // Failure 1 at t=1000, next delay=1000 (2^0)
    await vi.advanceTimersByTimeAsync(1050);
    expect(target.calls).toBe(1);
    expect(handle.consecutiveFailures).toBe(1);

    // Failure 2 at t=2050, next delay=2000 (2^1)
    await vi.advanceTimersByTimeAsync(1050);
    expect(target.calls).toBe(2);
    expect(handle.consecutiveFailures).toBe(2);

    // Success at t=4050 (delay was 2000)
    await vi.advanceTimersByTimeAsync(2050);
    expect(target.calls).toBe(3);
    expect(handle.consecutiveFailures).toBe(0);

    // Next call should be at 1000ms after success (reset to base interval)
    await vi.advanceTimersByTimeAsync(1050);
    expect(target.calls).toBe(4);

    handle.stop();
  });
});

// ─── 7. stop() ─────────────────────────────────────────────────────────────

describe("stop()", () => {
  it("cancels the loop — no more calls after stop()", async () => {
    const target = makeTarget(async () => false);
    const handle = startRecoveryLoop(target, { intervalMs: 500 });

    // Let one call happen
    await vi.advanceTimersByTimeAsync(600);
    expect(target.calls).toBe(1);

    handle.stop();

    // Advance well past several more intervals — should not call again
    await vi.advanceTimersByTimeAsync(3000);
    expect(target.calls).toBe(1);
  });

  it("stop() is idempotent — calling it twice does not throw", async () => {
    const target = makeTarget(async () => false);
    const handle = startRecoveryLoop(target, { intervalMs: 500 });

    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });
});
