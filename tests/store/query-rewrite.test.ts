import { describe, expect, it, vi } from "vitest";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import { rewriteQuery } from "../../src/store/query-rewrite.js";

describe("rewriteQuery — rule-based (Spec 10 Task 3)", () => {
  it("normalizes whitespace", () => {
    expect(rewriteQuery("  hello   world  ")).toBe("hello world");
  });

  it("filters stopwords (default English set)", () => {
    expect(rewriteQuery("what is the plan for the project")).toBe("plan project");
  });

  it("expands synonyms/abbreviations from a configurable map", () => {
    const out = rewriteQuery("k8s deploy", {
      synonyms: { k8s: ["kubernetes"], deploy: ["deployment", "release"] },
    });
    // Original terms are retained and expansions appended (recall, not replacement).
    expect(out.split(/\s+/).sort()).toEqual(
      ["deploy", "deployment", "k8s", "kubernetes", "release"].sort(),
    );
  });

  it("does not drop everything if the query is all stopwords", () => {
    // Falls back to normalized original so retrieval still has something to match.
    expect(rewriteQuery("the is for")).toBe("the is for");
  });

  it("does not duplicate terms when a synonym is already present", () => {
    const out = rewriteQuery("kubernetes k8s", {
      synonyms: { k8s: ["kubernetes"] },
    });
    expect(out.split(/\s+/).filter((t) => t === "kubernetes")).toHaveLength(1);
  });

  it("does NOT call the LLM when llm_rewrite is false (default)", async () => {
    const provider = createMockProvider(new Map([["", "should not be used"]]));
    const spy = vi.spyOn(provider, "chat");
    const out = await rewriteQuery("k8s deploy plan", {
      synonyms: { k8s: ["kubernetes"] },
      llm: { enabled: false, provider },
    });
    expect(spy).toHaveBeenCalledTimes(0);
    expect(out.split(/\s+/)).toContain("kubernetes");
  });

  it("calls the LLM only when llm_rewrite is true", async () => {
    const provider = createMockProvider(new Map([["", "kubernetes orchestration rollout"]]));
    const spy = vi.spyOn(provider, "chat");
    const out = await rewriteQuery("k8s", {
      llm: { enabled: true, provider },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    // LLM expansion terms are merged into the rewritten query.
    expect(out).toContain("kubernetes");
  });
});
