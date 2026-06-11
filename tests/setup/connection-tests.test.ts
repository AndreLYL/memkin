import { describe, expect, it, vi } from "vitest";
import {
  checkOllamaModel,
  checkOllamaRunning,
  testEmbeddingConnection,
  testLLMConnection,
} from "../../src/setup/connection-tests.js";

describe("setup connection tests", () => {
  it("passes mock LLM without an API key", async () => {
    await expect(testLLMConnection({ provider: "mock", model: "mock-model" })).resolves.toEqual({
      ok: true,
    });
  });

  it("fails non-mock LLM without an API key", async () => {
    await expect(testLLMConnection({ provider: "openai", model: "gpt-4o-mini" })).resolves.toEqual({
      ok: false,
      error: "No API key provided",
    });
  });

  it("posts to embedding endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(
        testEmbeddingConnection("https://example.test/v1", "sk-test", "text-embedding-3-large"),
      ).resolves.toEqual({
        ok: true,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.test/v1/embeddings",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("checks Ollama tags and model names", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "nomic-embed-text:latest" }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(checkOllamaRunning()).resolves.toBe(true);
      await expect(checkOllamaModel("nomic-embed-text")).resolves.toBe(true);
      await expect(checkOllamaModel("missing-model")).resolves.toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
