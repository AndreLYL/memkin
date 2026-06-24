import { describe, expect, it } from "vitest";
import { runUserPrompt } from "../../src/hooks/handlers.js";
import { INJECT_MAX_CHARS } from "../../src/hooks/inject.js";
import type { HookOutput } from "../../src/hooks/output.js";
import type { ScoredHit } from "../../src/hooks/recall-client.js";

describe("runUserPrompt", () => {
  it("injects gated top-3 hits within the char budget", async () => {
    const hits: ScoredHit[] = [
      { slug: "a", score: 0.9, snippet: "alpha" },
      { slug: "b", score: 0.8, snippet: "beta" },
      { slug: "c", score: 0.7, snippet: "gamma" },
      { slug: "d", score: 0.95, snippet: "delta" },
    ];
    const out = (await runUserPrompt(
      { prompt: "what about a?" },
      { recall: async () => hits },
    )) as HookOutput;
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(ctx).toContain("[a]");
    expect(ctx.split("\n- ").length - 1).toBeLessThanOrEqual(3); // at most 3 bullets
    expect(ctx.length).toBeLessThanOrEqual(INJECT_MAX_CHARS);
  });

  it("injects nothing for an empty prompt or no qualifying hits", async () => {
    expect(await runUserPrompt({ prompt: "   " }, { recall: async () => [] })).toEqual({});
    // all hits below threshold
    const low: ScoredHit[] = [{ slug: "x", score: 0.2, snippet: "meh" }];
    expect(await runUserPrompt({ prompt: "hi" }, { recall: async () => low })).toEqual({});
  });

  it("truncates over-budget injections", async () => {
    const big: ScoredHit[] = [
      { slug: "big", score: 0.9, snippet: "x".repeat(INJECT_MAX_CHARS * 2) },
    ];
    const out = (await runUserPrompt({ prompt: "p" }, { recall: async () => big })) as HookOutput;
    expect(out.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(INJECT_MAX_CHARS);
  });
});
