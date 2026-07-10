import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";

// Regression: a non-JSON HTTP response (e.g. MiniMax's `/anthropic` base hit with the
// OpenAI `/v1/chat/completions` path returns a plain-text "404 page not found") used to
// surface as a bare "Failed to parse JSON", hiding the real status. Both providers must
// now report the HTTP status and a body snippet so the misconfiguration is diagnosable.
afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchText(status: number, statusText: string, body: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body, { status, statusText, headers: { "content-type": "text/plain" } }),
  );
}

describe("provider error diagnostics on non-JSON responses", () => {
  it("anthropic surfaces the HTTP status and body instead of 'Failed to parse JSON'", async () => {
    mockFetchText(404, "Not Found", "404 page not found");
    const provider = createAnthropicProvider({
      apiKey: "k",
      model: "m",
      baseUrl: "https://api.minimaxi.com/anthropic",
    });
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /HTTP 404.*404 page not found/s,
    );
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.not.toThrow(
      /Failed to parse JSON/,
    );
  });

  it("openai surfaces the HTTP status and body instead of 'Failed to parse JSON'", async () => {
    mockFetchText(404, "Not Found", "404 page not found");
    const provider = createOpenAIProvider({
      apiKey: "k",
      model: "m",
      baseUrl: "https://api.minimaxi.com/anthropic",
    });
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /HTTP 404.*404 page not found/s,
    );
  });

  it("anthropic still parses a JSON error body and reports its message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "login fail" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = createAnthropicProvider({ apiKey: "bad", model: "m" });
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/login fail/);
  });
});
