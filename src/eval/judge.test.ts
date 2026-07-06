import { describe, expect, it } from "vitest";
import type { GoldenAnnotation } from "./golden.js";
import type { JudgeClient, PipelineSignal } from "./judge.js";
import { CALIBRATION_EXAMPLES, calibrateJudge, judge } from "./judge.js";

const golden: GoldenAnnotation = {
  session_ref: "ci-fixture:sess-1",
  should_record: [
    {
      type: "decision",
      authority: "user_confirmed",
      topic: "use-bun",
      what: "Use Bun instead of npm for package management.",
    },
    {
      type: "task",
      authority: "assistant_claimed",
      topic: "add-retry-logic",
      what: "Add retry logic with exponential backoff to the HTTP client.",
    },
    {
      type: "preference",
      authority: "user_confirmed",
      topic: "commit-style",
      what: "Always use conventional commits.",
    },
  ],
  should_not_record: [],
};

/** Builds a mock judge client whose semantic-equivalence verdicts are driven by a
 * lookup table keyed on (pipeline `what` substring, golden `what` substring), so
 * tests can assert judge()'s bucketing logic without a real LLM call. */
function mockClient(equivalentPairs: Array<[string, string]>): JudgeClient {
  return {
    async isEquivalent(a: string, b: string): Promise<boolean> {
      return equivalentPairs.some(
        ([x, y]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)),
      );
    },
  };
}

describe("judge", () => {
  it("buckets an exact semantic match into matched", async () => {
    const output: PipelineSignal[] = [
      {
        type: "decision",
        topic: "use-bun",
        what: "Use Bun instead of npm for package management.",
      },
    ];
    const client = mockClient([["Use Bun", "Use Bun"]]);
    const result = await judge(output, golden, client);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(2);
    expect(result.extra).toHaveLength(0);
  });

  it("buckets a golden signal with no pipeline counterpart as missed", async () => {
    const output: PipelineSignal[] = [];
    const client = mockClient([]);
    const result = await judge(output, golden, client);
    expect(result.matched).toHaveLength(0);
    expect(result.missed).toHaveLength(3);
    expect(result.extra).toHaveLength(0);
  });

  it("buckets a pipeline signal with no golden counterpart as extra", async () => {
    const output: PipelineSignal[] = [
      {
        type: "decision",
        topic: "use-bun",
        what: "Use Bun instead of npm for package management.",
      },
      { type: "discovery", topic: "random-noise", what: "Something the pipeline hallucinated." },
    ];
    const client = mockClient([["Use Bun", "Use Bun"]]);
    const result = await judge(output, golden, client);
    expect(result.matched).toHaveLength(1);
    expect(result.extra).toHaveLength(1);
    expect(result.extra[0].topic).toBe("random-noise");
  });

  it("never matches across different signal types even if semantically similar", async () => {
    const output: PipelineSignal[] = [
      {
        type: "knowledge",
        topic: "use-bun",
        what: "Use Bun instead of npm for package management.",
      },
    ];
    // Client would say these are equivalent by text, but type differs (decision vs knowledge).
    const client = mockClient([["Use Bun", "Use Bun"]]);
    const result = await judge(output, golden, client);
    expect(result.matched).toHaveLength(0);
    expect(result.extra).toHaveLength(1);
    expect(result.missed).toHaveLength(3);
  });

  it("does not double-match one pipeline signal against multiple golden signals", async () => {
    const output: PipelineSignal[] = [
      {
        type: "decision",
        topic: "use-bun",
        what: "Use Bun instead of npm for package management.",
      },
    ];
    // A permissive client that calls everything of the same type equivalent.
    const permissive: JudgeClient = {
      async isEquivalent() {
        return true;
      },
    };
    const goldenTwoDecisions: GoldenAnnotation = {
      session_ref: "x",
      should_record: [
        { type: "decision", authority: "user_confirmed", topic: "a", what: "A" },
        { type: "decision", authority: "user_confirmed", topic: "b", what: "B" },
      ],
      should_not_record: [],
    };
    const result = await judge(output, goldenTwoDecisions, permissive);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(1);
    expect(result.extra).toHaveLength(0);
  });
});

describe("calibrateJudge", () => {
  it("reports 5/5 for a perfect client and lists no failures", async () => {
    const perfectClient: JudgeClient = {
      async isEquivalent(a: string, b: string) {
        const example = CALIBRATION_EXAMPLES.find((e) => e.a === a && e.b === b);
        return example ? example.expectedEquivalent : false;
      },
    };
    const report = await calibrateJudge(perfectClient);
    expect(report.total).toBe(5);
    expect(report.correct).toBe(5);
    expect(report.failures).toHaveLength(0);
  });

  it("reports failures for a client that always says yes", async () => {
    const alwaysYes: JudgeClient = {
      async isEquivalent() {
        return true;
      },
    };
    const report = await calibrateJudge(alwaysYes);
    expect(report.correct).toBeLessThan(report.total);
    expect(report.failures.length).toBeGreaterThan(0);
  });
});
