import { afterEach, describe, expect, it, vi } from "vitest";
import { testLLMConnection } from "./connection-tests.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("testLLMConnection", () => {
  it("treats a reasoning model's empty-text (but successful) response as a working connection", async () => {
    // MiniMax M2 and other reasoning models can spend a small token budget entirely on
    // hidden thinking, returning content blocks with no `type: "text"` — a valid response
    // that used to fail the test with "Anthropic API returned empty text content".
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "…" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await testLLMConnection({
      provider: "anthropic",
      model: "MiniMax-M2.7-highspeed",
      baseUrl: "https://api.minimaxi.com/anthropic",
      apiKey: "sk-cp-x",
    });
    expect(res.ok).toBe(true);
  });

  it("still reports a real auth failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "login fail" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await testLLMConnection({
      provider: "anthropic",
      model: "m",
      baseUrl: "https://api.minimaxi.com/anthropic",
      apiKey: "bad",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/login fail/);
  });
});
