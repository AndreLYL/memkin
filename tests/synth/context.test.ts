import { describe, expect, it } from "vitest";
import { assemble } from "../../src/synth/context.js";
import type { RawCandidate } from "../../src/synth/scope.js";

describe("synth/context assemble", () => {
  const raw: RawCandidate[] = [
    { slug: "a", title: "A", type: "decision", text: "alpha", date: "2026-06-01" },
    { slug: "b", title: "B", type: "task", text: "beta", date: "2026-06-15" },
    { slug: "c", title: "C", type: "note", text: "gamma" },
  ];

  it("numbers candidates ref=1..N in order", () => {
    const ctx = assemble({ query: "x" }, raw);
    expect(ctx.candidates.map((c) => c.ref)).toEqual([1, 2, 3]);
    expect(ctx.candidates[0].slug).toBe("a");
  });

  it("computes latestDate as max(date)", () => {
    const ctx = assemble({ query: "x" }, raw);
    expect(ctx.latestDate).toBe("2026-06-15");
  });

  it("pinnedContext is undefined by default", () => {
    const ctx = assemble({ query: "x" }, raw);
    expect(ctx.pinnedContext).toBeUndefined();
  });

  it("carries the scope through", () => {
    const ctx = assemble({ entity: "people/zhang-san" }, raw);
    expect(ctx.scope.entity).toBe("people/zhang-san");
  });

  it("latestDate is undefined when no candidate has a date", () => {
    const ctx = assemble({ query: "x" }, [{ slug: "c", title: "C", type: "note", text: "g" }]);
    expect(ctx.latestDate).toBeUndefined();
  });

  it("keeps distinct timeline entries that share one entity slug (different text)", () => {
    // Entity-scope retrieval pushes every timeline entry under slug=scope.entity;
    // dedupe must key on slug+text so these are NOT collapsed to one.
    const timeline: RawCandidate[] = [
      {
        slug: "entities/alice",
        title: "Met",
        type: "timeline",
        text: "kickoff",
        date: "2026-06-01",
      },
      {
        slug: "entities/alice",
        title: "Met",
        type: "timeline",
        text: "review",
        date: "2026-06-10",
      },
      { slug: "entities/alice", title: "Met", type: "timeline", text: "ship", date: "2026-06-20" },
    ];
    const ctx = assemble({ entity: "entities/alice" }, timeline);
    expect(ctx.candidates.length).toBe(3);
    expect(ctx.candidates.map((c) => c.text)).toEqual(["kickoff", "review", "ship"]);
  });

  it("dedupes candidates with identical slug AND text to one", () => {
    const dupes: RawCandidate[] = [
      {
        slug: "entities/alice",
        title: "Met",
        type: "timeline",
        text: "kickoff",
        date: "2026-06-01",
      },
      {
        slug: "entities/alice",
        title: "Met",
        type: "timeline",
        text: "kickoff",
        date: "2026-06-01",
      },
    ];
    const ctx = assemble({ entity: "entities/alice" }, dupes);
    expect(ctx.candidates.length).toBe(1);
  });
});
