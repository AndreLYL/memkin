import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startEmbedSweep } from "./embed-sweep.js";

interface SweepResult {
  embedded: number;
  errors: number;
}

function makeTarget(results: Array<SweepResult | Error>) {
  const calls: Array<{ limit?: number }> = [];
  let i = 0;
  return {
    calls,
    embedStale: vi.fn(async (opts?: { limit?: number }) => {
      calls.push({ limit: opts?.limit });
      const r = results[Math.min(i, results.length - 1)];
      i++;
      if (r instanceof Error) throw r;
      return r;
    }),
  };
}

describe("startEmbedSweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweeps at the configured interval with the batch limit", async () => {
    const target = makeTarget([{ embedded: 3, errors: 0 }]);
    const sweep = startEmbedSweep(target, { intervalMs: 60_000, batchLimit: 100 });

    expect(target.embedStale).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);
    expect(target.calls[0].limit).toBe(100);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.embedStale).toHaveBeenCalledTimes(2);
    sweep.stop();
  });

  it("drains a backlog faster: full batch → next sweep after drainDelayMs", async () => {
    const target = makeTarget([
      { embedded: 100, errors: 0 }, // full batch — backlog remains
      { embedded: 20, errors: 0 }, // partial — backlog drained
    ]);
    const sweep = startEmbedSweep(target, {
      intervalMs: 60_000,
      batchLimit: 100,
      drainDelayMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);

    // Full batch → drain mode kicks in after only drainDelayMs
    await vi.advanceTimersByTimeAsync(5_000);
    expect(target.embedStale).toHaveBeenCalledTimes(2);

    // Partial batch → back to the normal interval
    await vi.advanceTimersByTimeAsync(5_000);
    expect(target.embedStale).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(target.embedStale).toHaveBeenCalledTimes(3);
    sweep.stop();
  });

  it("never overlaps sweeps: reschedules only after the current one resolves", async () => {
    let release: () => void = () => {};
    const target = {
      embedStale: vi.fn(
        () =>
          new Promise<SweepResult>((resolve) => {
            release = () => resolve({ embedded: 0, errors: 0 });
          }),
      ),
    };
    const sweep = startEmbedSweep(target, { intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);

    // Interval elapses many times while the first sweep is still in flight
    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(target.embedStale).toHaveBeenCalledTimes(2);
    sweep.stop();
  });

  it("keeps running after an error, with exponential backoff, and recovers", async () => {
    const onError = vi.fn();
    const target = makeTarget([
      new Error("no api key"),
      new Error("no api key"),
      { embedded: 1, errors: 0 },
    ]);
    const sweep = startEmbedSweep(target, {
      intervalMs: 10_000,
      maxIntervalMs: 60_000,
      onError,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // First failure → backoff doubles the delay (2 × 10s)
    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.embedStale).toHaveBeenCalledTimes(2);

    // Second failure → 4 × 10s
    await vi.advanceTimersByTimeAsync(40_000);
    expect(target.embedStale).toHaveBeenCalledTimes(3);

    // Success resets to the base interval
    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.embedStale).toHaveBeenCalledTimes(4);
    sweep.stop();
  });

  it("reports sweep results via onSweep, and skips reporting empty sweeps", async () => {
    const onSweep = vi.fn();
    const target = makeTarget([
      { embedded: 5, errors: 2 },
      { embedded: 0, errors: 0 },
    ]);
    const sweep = startEmbedSweep(target, { intervalMs: 1_000, onSweep });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSweep).toHaveBeenCalledWith({ embedded: 5, errors: 2 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSweep).toHaveBeenCalledTimes(1);
    sweep.stop();
  });

  it("stop() prevents any further sweeps, including one already scheduled", async () => {
    const target = makeTarget([{ embedded: 0, errors: 0 }]);
    const sweep = startEmbedSweep(target, { intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);

    sweep.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(target.embedStale).toHaveBeenCalledTimes(1);
  });
});
