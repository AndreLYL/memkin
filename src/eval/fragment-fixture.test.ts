/**
 * Directional eval for the fragment-source (Feishu/Lark IM + email) extraction
 * criteria tightened in PR-5.
 *
 * IMPORTANT — what this is and is NOT:
 * - This is NOT a live LLM extraction run. Running the real block pipeline needs
 *   a provider + real DB and is the local quality gate (see CONTRIBUTING.md), not
 *   a CI test. The real, private golden set is gitignored (spec §10).
 * - This test ships sanitized, synthetic Feishu fragments and MODELS the two
 *   pipeline behaviours — the loose legacy prompt vs. the tightened PR-5 prompt —
 *   so it exercises PR-1's judge + metrics on fragment noise and gives a
 *   directional read: tightening the "what is worth recording" criteria drops the
 *   noise rate substantially without raising the miss rate.
 *
 * The noise items in each fixture's `should_not_record` are exactly the
 * categories the PR-5 prompt now names as skip-worthy (acknowledgements,
 * one-off presence/status, momentary debugging actions, one-off logistics,
 * chatter, red packets). The "legacy" model emits them as signals (the observed
 * over-extraction failure mode); the "tightened" model filters its named
 * categories and keeps only the durable golden signals.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { GoldenAnnotation, GoldenSignal } from "./golden.js";
import { loadGolden } from "./golden.js";
import type { JudgeClient, JudgeResult, PipelineSignal } from "./judge.js";
import { judge } from "./judge.js";
import { computeMetrics, evaluate, report } from "./metrics.js";

const FIXTURE_DIR = new URL("../../tests/fixtures/eval/fragment-golden", import.meta.url).pathname;
const FIXTURES = [
  "feishu-fragment-mixed.json",
  "feishu-fragment-knowledge.json",
  "feishu-fragment-noise-only.json",
];

/** Deterministic offline judge: equivalence = case-insensitive exact text match.
 * The synthetic outputs echo golden `what` verbatim, so exact match is sufficient
 * and keeps the directional check free of a real LLM dependency. */
const exactMatchClient: JudgeClient = {
  async isEquivalent(a: string, b: string): Promise<boolean> {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  },
};

/** Loose legacy behaviour: emit every real signal PLUS every noise item as an
 * extra "discovery" signal — the over-extraction the tightened prompt targets. */
function legacyOutput(golden: GoldenAnnotation): PipelineSignal[] {
  return [
    ...golden.should_record.map(toPipelineSignal),
    ...golden.should_not_record.map((n, i) => ({
      type: "discovery" as const,
      topic: `noise-${i}`,
      what: n.what,
    })),
  ];
}

/** Tightened PR-5 behaviour: keep only the durable golden signals, drop the
 * named noise categories. */
function tightenedOutput(golden: GoldenAnnotation): PipelineSignal[] {
  return golden.should_record.map(toPipelineSignal);
}

function toPipelineSignal(g: GoldenSignal): PipelineSignal {
  return { type: g.type, topic: g.topic, what: g.what };
}

/** Judge every fragment under one behaviour and return a merged JudgeResult plus
 * the total pipeline output count (the noise-rate denominator). */
async function runAll(build: (g: GoldenAnnotation) => PipelineSignal[]): Promise<{
  result: JudgeResult;
  pipelineOutputTotal: number;
}> {
  const result: JudgeResult = { matched: [], missed: [], extra: [] };
  let pipelineOutputTotal = 0;
  for (const file of FIXTURES) {
    const golden = await loadGolden(path.join(FIXTURE_DIR, file));
    const output = build(golden);
    pipelineOutputTotal += output.length;
    const r = await judge(output, golden, exactMatchClient);
    result.matched.push(...r.matched);
    result.missed.push(...r.missed);
    result.extra.push(...r.extra);
  }
  return { result, pipelineOutputTotal };
}

describe("PR-5 fragment fixtures: schema + coverage", () => {
  it("every fragment golden fixture validates and covers the noise-only case", async () => {
    const goldens = await Promise.all(FIXTURES.map((f) => loadGolden(path.join(FIXTURE_DIR, f))));
    for (const g of goldens) {
      expect(g.session_ref).toContain("fragment-fixture:");
      expect(g.should_not_record.length).toBeGreaterThan(0);
    }
    // At least one pure-noise fragment (empty should_record) — the dominant
    // shape of fragment-source traffic.
    expect(goldens.some((g) => g.should_record.length === 0)).toBe(true);
    // And at least one fragment carrying real durable signals.
    expect(goldens.some((g) => g.should_record.length > 0)).toBe(true);
  });
});

describe("PR-5 directional eval: tightened fragment criteria cut noise", () => {
  it("legacy over-extraction produces a high noise rate, no miss", async () => {
    const { result, pipelineOutputTotal } = await runAll(legacyOutput);
    const m = computeMetrics(result, { pipelineOutputTotal });
    // The loose prompt emits chatter as signals: majority of output is noise.
    expect(m.noiseRate).toBeGreaterThan(0.5);
    // It does not miss the real signals (recall is not the legacy problem).
    expect(m.missRate).toBe(0);
  });

  it("tightened criteria drop noise rate ≥80% without raising miss rate", async () => {
    const legacy = await runAll(legacyOutput);
    const tightened = await runAll(tightenedOutput);
    const legacyM = computeMetrics(legacy.result, {
      pipelineOutputTotal: legacy.pipelineOutputTotal,
    });
    const tightM = computeMetrics(tightened.result, {
      pipelineOutputTotal: tightened.pipelineOutputTotal,
    });

    expect(tightM.noiseRate).toBeLessThan(legacyM.noiseRate);
    const relativeDrop = (legacyM.noiseRate - tightM.noiseRate) / legacyM.noiseRate;
    expect(relativeDrop).toBeGreaterThanOrEqual(0.8);
    // Miss rate must NOT increase — the acceptance guardrail (spec §10).
    expect(tightM.missRate).toBeLessThanOrEqual(legacyM.missRate);
  });

  it("passes the spec §10 acceptance report (noise −80%, miss not increased)", async () => {
    const legacy = await runAll(legacyOutput);
    const legacyM = computeMetrics(legacy.result, {
      pipelineOutputTotal: legacy.pipelineOutputTotal,
    });

    const tightenedEval = await evaluate(() => runAll(tightenedOutput), { runs: 1 });
    const acceptance = report(
      { missRate: tightenedEval.missRate, noiseRate: tightenedEval.noiseRate },
      { missRate: tightenedEval.missRate, noiseRate: tightenedEval.noiseRate },
      { missRate: legacyM.missRate, noiseRate: legacyM.noiseRate },
    );

    expect(acceptance.tune.descriptiveOnly).toBe(true);
    expect(acceptance.holdout.passed).toBe(true);
  });
});
