import { describe, expect, it } from "vitest";
import { missingFieldRule, staleRule } from "../../src/synth/gaps.js";
import type { AssembledContext, ComposeOutput, IntentTemplate } from "../../src/synth/types.js";

function ctx(latestDate?: string): AssembledContext {
  return { scope: {}, candidates: [], latestDate };
}

function intent(over: Partial<IntentTemplate>): IntentTemplate {
  return {
    id: "test",
    format: "single",
    buildScope: () => ({}),
    systemPrompt: "",
    gapRules: [],
    ...over,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("synth/gaps staleRule", () => {
  it("returns a stale gap when latestDate is older than staleDays", () => {
    const gaps = staleRule.evaluate(
      ctx(daysAgo(20)),
      { answer: "" },
      intent({ staleDays: 14 }),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].type).toBe("stale");
  });

  it("returns no gap when within staleDays", () => {
    const gaps = staleRule.evaluate(ctx(daysAgo(3)), { answer: "" }, intent({ staleDays: 14 }));
    expect(gaps).toEqual([]);
  });

  it("returns no gap when there is no latestDate", () => {
    const gaps = staleRule.evaluate(ctx(undefined), { answer: "" }, intent({ staleDays: 14 }));
    expect(gaps).toEqual([]);
  });
});

describe("synth/gaps missingFieldRule", () => {
  const raw: ComposeOutput = { answer: "We discussed the budget and the timeline." };

  it("flags expects points not covered by the answer", () => {
    const gaps = missingFieldRule.evaluate(
      ctx(),
      raw,
      intent({ expects: ["budget", "owner"] }),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].type).toBe("missing_field");
    expect(gaps[0].message).toContain("owner");
  });

  it("returns no gap when all expects are covered", () => {
    const gaps = missingFieldRule.evaluate(
      ctx(),
      { answer: "budget and owner are set" },
      intent({ expects: ["budget", "owner"] }),
    );
    expect(gaps).toEqual([]);
  });

  it("returns no gap when expects is empty/undefined", () => {
    expect(missingFieldRule.evaluate(ctx(), raw, intent({ expects: [] }))).toEqual([]);
    expect(missingFieldRule.evaluate(ctx(), raw, intent({}))).toEqual([]);
  });
});
