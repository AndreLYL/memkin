import { describe, expect, it } from "vitest";
import type { LLMConfig } from "../../core/config.js";
import { createLLMProvider } from "./index.js";

const baseConfig: LLMConfig = {
  provider: "openai",
  model: "gpt-4o-mini",
  base_url: "http://127.0.0.1:15721",
  api_key: "sk-test",
};

describe("createLLMProvider provider aliases", () => {
  it("treats the Web UI 'custom' provider as an OpenAI-compatible provider", () => {
    const provider = createLLMProvider({ ...baseConfig, provider: "custom" });
    expect(typeof provider.chat).toBe("function");
  });

  it("treats CLI 'openai-compatible' as an OpenAI-compatible provider", () => {
    const provider = createLLMProvider({ ...baseConfig, provider: "openai-compatible" });
    expect(typeof provider.chat).toBe("function");
  });

  it("still instantiates the canonical providers", () => {
    expect(typeof createLLMProvider({ ...baseConfig, provider: "openai" }).chat).toBe("function");
    expect(
      typeof createLLMProvider({
        ...baseConfig,
        provider: "anthropic",
        base_url: "https://api.anthropic.com",
      }).chat,
    ).toBe("function");
    expect(typeof createLLMProvider({ ...baseConfig, provider: "mock" }).chat).toBe("function");
  });

  it("still rejects genuinely unknown providers", () => {
    expect(() => createLLMProvider({ ...baseConfig, provider: "gemini" })).toThrow(
      /Unsupported LLM provider: gemini/,
    );
  });
});
