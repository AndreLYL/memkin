import { describe, expect, it } from "vitest";
import { getDistillCriteria, getMapPrompt, getReducePrompt } from "./prompt.js";

describe("distill prompt (spec §11 task: judgment-declaration criteria)", () => {
  it("loads the embedded distill.md criteria (not the fallback)", () => {
    const criteria = getDistillCriteria();
    // Judgment-declaration essentials from the spec:
    expect(criteria).toContain("30 days");
    expect(criteria).toContain("user_confirmed");
    expect(criteria).toContain("assistant_proposed");
    expect(criteria).toContain("assistant_claimed");
    // Embedded doc, not the terse fallback.
    expect(criteria).toContain("# Session Distillation Criteria");
  });

  it("map prompt embeds criteria, segment text and carry-forward", () => {
    const p = getMapPrompt({
      segmentText: "[msg-1] user: hello",
      segNo: 2,
      carryForward: "undecided: bun vs deno",
    });
    expect(p).toContain("Session Distillation Criteria");
    expect(p).toContain("[msg-1] user: hello");
    expect(p).toContain("undecided: bun vs deno");
    expect(p).toContain('"seg_no": 2');
  });

  it("reduce prompt lists overturned topics with the exclusion rule", () => {
    const p = getReducePrompt({
      segmentSummaries: [],
      overturnedTopics: ["Use Deno"],
    });
    expect(p).toContain("Use Deno");
    expect(p).toMatch(/MUST NOT/);
  });
});
