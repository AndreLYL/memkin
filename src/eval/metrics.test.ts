import { describe, expect, it } from "vitest";
import type { JudgeResult } from "./judge.js";
import { computeDupRate, computeMetrics, evaluate, report } from "./metrics.js";

function fakeJudgeResult(matchedN: number, missedN: number, extraN: number): JudgeResult {
  return {
    matched: Array.from({ length: matchedN }, (_, i) => ({
      pipeline: { type: "decision" as const, topic: `p${i}`, what: `p${i}` },
      golden: {
        type: "decision" as const,
        authority: "user_confirmed" as const,
        topic: `g${i}`,
        what: `g${i}`,
      },
    })),
    missed: Array.from({ length: missedN }, (_, i) => ({
      type: "decision" as const,
      authority: "user_confirmed" as const,
      topic: `m${i}`,
      what: `m${i}`,
    })),
    extra: Array.from({ length: extraN }, (_, i) => ({
      type: "decision" as const,
      topic: `e${i}`,
      what: `e${i}`,
    })),
  };
}

describe("computeMetrics", () => {
  it("computes miss rate as missed / golden total", () => {
    // golden total = matched + missed = 3 + 2 = 5
    const result = fakeJudgeResult(3, 2, 1);
    const metrics = computeMetrics(result, { pipelineOutputTotal: 4 });
    expect(metrics.missRate).toBeCloseTo(2 / 5);
  });

  it("computes noise rate as extra / pipeline output total", () => {
    const result = fakeJudgeResult(3, 2, 1);
    const metrics = computeMetrics(result, { pipelineOutputTotal: 4 });
    expect(metrics.noiseRate).toBeCloseTo(1 / 4);
  });

  it("handles zero golden signals without dividing by zero", () => {
    const result = fakeJudgeResult(0, 0, 2);
    const metrics = computeMetrics(result, { pipelineOutputTotal: 2 });
    expect(metrics.missRate).toBe(0);
    expect(metrics.noiseRate).toBeCloseTo(1);
  });

  it("handles zero pipeline output without dividing by zero", () => {
    const result = fakeJudgeResult(0, 3, 0);
    const metrics = computeMetrics(result, { pipelineOutputTotal: 0 });
    expect(metrics.noiseRate).toBe(0);
    expect(metrics.missRate).toBeCloseTo(1);
  });
});

describe("computeDupRate", () => {
  it("computes Σ(group size - 1) / total pages, spec §10 corrected formula", () => {
    // groups of duplicate pages by size: two groups of size 3 and one of size 2,
    // total pages in the library = 10.
    const dupRate = computeDupRate({ groupSizes: [3, 3, 2], totalPages: 10 });
    // (3-1) + (3-1) + (2-1) = 5; 5/10 = 0.5
    expect(dupRate).toBeCloseTo(0.5);
  });

  it("returns 0 when there are no duplicate groups", () => {
    expect(computeDupRate({ groupSizes: [], totalPages: 100 })).toBe(0);
  });

  it("ignores singleton groups (size 1 contributes 0)", () => {
    const dupRate = computeDupRate({ groupSizes: [1, 1, 1], totalPages: 10 });
    expect(dupRate).toBe(0);
  });

  it("returns 0 when totalPages is 0 (avoids NaN)", () => {
    expect(computeDupRate({ groupSizes: [3], totalPages: 0 })).toBe(0);
  });
});

describe("evaluate", () => {
  it("runs the given judge function 3 times and returns mean ± variance", async () => {
    let call = 0;
    const results = [
      { result: fakeJudgeResult(3, 2, 1), pipelineOutputTotal: 4 },
      { result: fakeJudgeResult(3, 1, 2), pipelineOutputTotal: 5 },
      { result: fakeJudgeResult(3, 3, 0), pipelineOutputTotal: 3 },
    ];
    const runJudge = async () => {
      const r = results[call];
      call++;
      return r;
    };
    const evaluation = await evaluate(runJudge, { runs: 3 });
    expect(call).toBe(3);
    expect(evaluation.missRate.mean).toBeGreaterThan(0);
    expect(evaluation.noiseRate.mean).toBeGreaterThan(0);
    expect(typeof evaluation.missRate.variance).toBe("number");
    expect(typeof evaluation.noiseRate.variance).toBe("number");
  });

  it("defaults to 3 runs when not specified", async () => {
    let calls = 0;
    const runJudge = async () => {
      calls++;
      return { result: fakeJudgeResult(1, 0, 0), pipelineOutputTotal: 1 };
    };
    await evaluate(runJudge);
    expect(calls).toBe(3);
  });
});

describe("report", () => {
  it("marks tune results as descriptive-only and judges pass/fail only on holdout", () => {
    const tune = {
      missRate: { mean: 0.5, variance: 0.01 },
      noiseRate: { mean: 0.9, variance: 0.01 },
    };
    const holdout = {
      missRate: { mean: 0.1, variance: 0.02 },
      noiseRate: { mean: 0.05, variance: 0.02 },
    };
    const baseline = { missRate: 0.15, noiseRate: 0.3 };
    const r = report(tune, holdout, baseline);
    expect(r.tune.descriptiveOnly).toBe(true);
    expect(r.holdout.descriptiveOnly).toBe(false);
    expect(typeof r.holdout.passed).toBe("boolean");
    expect(r.tune).not.toHaveProperty("passed");
  });

  it("passes when holdout noise rate drops >=80% vs baseline and miss rate does not increase", () => {
    const tune = { missRate: { mean: 0, variance: 0 }, noiseRate: { mean: 0, variance: 0 } };
    const holdout = {
      missRate: { mean: 0.1, variance: 0 },
      noiseRate: { mean: 0.05, variance: 0 }, // 0.3 -> 0.05 is an 83% drop
    };
    const baseline = { missRate: 0.12, noiseRate: 0.3 };
    const r = report(tune, holdout, baseline);
    expect(r.holdout.passed).toBe(true);
  });

  it("fails when holdout miss rate increases versus baseline even if noise dropped enough", () => {
    const tune = { missRate: { mean: 0, variance: 0 }, noiseRate: { mean: 0, variance: 0 } };
    const holdout = {
      missRate: { mean: 0.2, variance: 0 }, // worse than baseline 0.12
      noiseRate: { mean: 0.05, variance: 0 },
    };
    const baseline = { missRate: 0.12, noiseRate: 0.3 };
    const r = report(tune, holdout, baseline);
    expect(r.holdout.passed).toBe(false);
  });

  it("fails when holdout noise rate drop is less than 80%", () => {
    const tune = { missRate: { mean: 0, variance: 0 }, noiseRate: { mean: 0, variance: 0 } };
    const holdout = {
      missRate: { mean: 0.1, variance: 0 },
      noiseRate: { mean: 0.2, variance: 0 }, // 0.3 -> 0.2 is only a 33% drop
    };
    const baseline = { missRate: 0.12, noiseRate: 0.3 };
    const r = report(tune, holdout, baseline);
    expect(r.holdout.passed).toBe(false);
  });
});
