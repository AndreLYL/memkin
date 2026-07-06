/**
 * Quality metrics for the extraction pipeline (spec §10):
 *
 *   miss rate  = missed  / golden total          (golden total = matched + missed)
 *   noise rate = extra   / pipeline output total
 *   dup rate   = Σ(each duplicate group size − 1) / total pages
 *                (measured on the final library after apply, not on judge output —
 *                 spec §10 explicitly corrects the v2 formula)
 *
 * Each evaluation run is repeated 3x and reported as mean ± variance (spec §10),
 * because a single LLM-judge pass is noisy. Acceptance is judged ONLY on the
 * locked holdout split — the tune split is always descriptive-only (spec §10,
 * R3 收紧-2): judging on the full/tune set would be training-set leakage.
 */

import type { JudgeResult } from "./judge.js";

export interface SignalMetrics {
  missRate: number;
  noiseRate: number;
}

/** Compute miss rate and noise rate from a single judge() result. */
export function computeMetrics(
  result: JudgeResult,
  opts: { pipelineOutputTotal: number },
): SignalMetrics {
  const goldenTotal = result.matched.length + result.missed.length;
  const missRate = goldenTotal === 0 ? 0 : result.missed.length / goldenTotal;
  const noiseRate =
    opts.pipelineOutputTotal === 0 ? 0 : result.extra.length / opts.pipelineOutputTotal;
  return { missRate, noiseRate };
}

/**
 * Duplicate rate on the final materialized library: Σ(size−1) over every group of
 * pages judged duplicates of one another, divided by total page count.
 * A group of size 1 (no duplicates) contributes 0.
 */
export function computeDupRate(opts: { groupSizes: number[]; totalPages: number }): number {
  if (opts.totalPages === 0) return 0;
  const sumExcessCopies = opts.groupSizes.reduce((acc, size) => acc + Math.max(0, size - 1), 0);
  return sumExcessCopies / opts.totalPages;
}

export interface RunResult {
  result: JudgeResult;
  pipelineOutputTotal: number;
}

export interface MetricStats {
  mean: number;
  variance: number;
}

export interface EvaluationResult {
  missRate: MetricStats;
  noiseRate: MetricStats;
  runs: SignalMetrics[];
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[], avg: number): number {
  if (values.length <= 1) return 0;
  return mean(values.map((v) => (v - avg) ** 2));
}

/**
 * Run the given judge callback `runs` times (default 3, per spec §10) and return
 * mean ± variance for miss rate and noise rate across the runs.
 */
export async function evaluate(
  runJudge: () => Promise<RunResult>,
  opts: { runs?: number } = {},
): Promise<EvaluationResult> {
  const runs = opts.runs ?? 3;
  const perRun: SignalMetrics[] = [];

  for (let i = 0; i < runs; i++) {
    // Sequential by design: each run may hit a real LLM judge, and we want
    // deterministic ordering for reproducibility across evaluate() calls.
    const { result, pipelineOutputTotal } = await runJudge();
    perRun.push(computeMetrics(result, { pipelineOutputTotal }));
  }

  const missRates = perRun.map((r) => r.missRate);
  const noiseRates = perRun.map((r) => r.noiseRate);
  const missMean = mean(missRates);
  const noiseMean = mean(noiseRates);

  return {
    missRate: { mean: missMean, variance: variance(missRates, missMean) },
    noiseRate: { mean: noiseMean, variance: variance(noiseRates, noiseMean) },
    runs: perRun,
  };
}

export interface BaselineMetrics {
  missRate: number;
  noiseRate: number;
}

export interface SplitReport {
  missRate: MetricStats;
  noiseRate: MetricStats;
  descriptiveOnly: boolean;
  passed?: boolean;
}

export interface AcceptanceReport {
  tune: SplitReport;
  holdout: SplitReport;
}

/**
 * Build the acceptance report for an evaluation run (spec §10, R3 收紧-2):
 *
 * - tune split results are ALWAYS descriptive-only (`descriptiveOnly: true`,
 *   no `passed` field) — used to iterate prompts/thresholds, never to judge
 *   pass/fail.
 * - holdout split results are the only ones that carry a `passed` verdict:
 *   noise rate must drop by at least 80% vs. the legacy baseline, AND miss
 *   rate must not increase vs. baseline. The conclusion should be reported as
 *   directional ("noise rate dropped substantially without a miss rate
 *   regression"), not as a claim of statistical significance — holdout sizes
 *   in this spec are small (6-9 samples).
 */
export function report(
  tune: { missRate: MetricStats; noiseRate: MetricStats },
  holdout: { missRate: MetricStats; noiseRate: MetricStats },
  baseline: BaselineMetrics,
): AcceptanceReport {
  const noiseDrop =
    baseline.noiseRate === 0
      ? 0
      : (baseline.noiseRate - holdout.noiseRate.mean) / baseline.noiseRate;
  const missNotIncreased = holdout.missRate.mean <= baseline.missRate;
  const passed = noiseDrop >= 0.8 && missNotIncreased;

  return {
    tune: {
      missRate: tune.missRate,
      noiseRate: tune.noiseRate,
      descriptiveOnly: true,
    },
    holdout: {
      missRate: holdout.missRate,
      noiseRate: holdout.noiseRate,
      descriptiveOnly: false,
      passed,
    },
  };
}
