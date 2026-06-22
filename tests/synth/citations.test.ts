import { describe, expect, it } from "vitest";
import { finalize } from "../../src/synth/citations.js";
import type { AssembledCandidate } from "../../src/synth/types.js";

const candidates: AssembledCandidate[] = [
  { ref: 1, slug: "a", title: "A", type: "decision", text: "alpha", date: "2026-06-01" },
  { ref: 2, slug: "b", title: "B", type: "task", text: "beta" },
  { ref: 3, slug: "c", title: "C", type: "note", text: "gamma" },
];

describe("synth/citations finalize", () => {
  it("returns only candidates actually referenced", () => {
    const { citations } = finalize("We shipped [1] and tracked [3].", candidates);
    expect(citations.map((c) => c.ref)).toEqual([1, 3]);
    expect(citations.find((c) => c.ref === 1)?.slug).toBe("a");
  });

  it("strips pseudo-references outside 1..N from the answer and citations", () => {
    const { answer, citations } = finalize("Real [2] but fake [99] here.", candidates);
    expect(answer).not.toContain("[99]");
    expect(answer).toContain("[2]");
    expect(citations.map((c) => c.ref)).toEqual([2]);
  });

  it("returns no citations when answer cites nothing", () => {
    const { citations } = finalize("No citations at all.", candidates);
    expect(citations).toEqual([]);
  });

  it("dedupes repeated references", () => {
    const { citations } = finalize("[1] again [1] and [2].", candidates);
    expect(citations.map((c) => c.ref)).toEqual([1, 2]);
  });
});
