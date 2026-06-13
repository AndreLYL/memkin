import { describe, expect, test } from "vitest";
import {
  batchSizeForRun,
  UpgradeQueue,
} from "../../../../src/collectors/feishu/docs/upgrade-queue";

describe("UpgradeQueue", () => {
  test("enqueue dedupes and respects max_pending cap (drops overflow)", () => {
    const q = new UpgradeQueue(["a"], 3);
    expect(q.enqueue("a")).toBe(false); // already present
    expect(q.enqueue("b")).toBe(true);
    expect(q.enqueue("c")).toBe(true);
    expect(q.enqueue("d")).toBe(false); // cap=3 reached → dropped
    expect(q.pending()).toEqual(["a", "b", "c"]);
  });

  test("shift returns up to K and removes them", () => {
    const q = new UpgradeQueue(["a", "b", "c"], 100);
    expect(q.shift(2)).toEqual(["a", "b"]);
    expect(q.pending()).toEqual(["c"]);
  });
});

describe("batchSizeForRun", () => {
  test("uses bootstrap size during bootstrap window", () => {
    expect(
      batchSizeForRun(0, {
        batch_size: 20,
        bootstrap_batch_size: 50,
        bootstrap_runs: 5,
        max_pending: 5000,
      }),
    ).toBe(50);
    expect(
      batchSizeForRun(4, {
        batch_size: 20,
        bootstrap_batch_size: 50,
        bootstrap_runs: 5,
        max_pending: 5000,
      }),
    ).toBe(50);
  });

  test("uses steady-state size after bootstrap", () => {
    expect(
      batchSizeForRun(5, {
        batch_size: 20,
        bootstrap_batch_size: 50,
        bootstrap_runs: 5,
        max_pending: 5000,
      }),
    ).toBe(20);
  });
});
