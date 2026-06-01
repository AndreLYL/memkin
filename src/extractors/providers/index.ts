/**
 * LLM Provider factory
 * Creates provider instances based on configuration
 */

import type { LLMConfig } from "../../core/config.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createMockProvider } from "./mock.js";
import { createOpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export function createLLMProvider(config: LLMConfig): LLMProvider {
  const { provider, model, api_key, base_url } = config;

  switch (provider) {
    case "openai": {
      if (!api_key) {
        throw new Error("OpenAI provider requires api_key in config");
      }
      return createOpenAIProvider({
        apiKey: api_key,
        model,
        baseUrl: base_url,
      });
    }

    case "anthropic": {
      if (!api_key) {
        throw new Error("Anthropic provider requires api_key in config");
      }
      return createAnthropicProvider({
        apiKey: api_key,
        model,
        baseUrl: base_url,
      });
    }

    case "mock": {
      return createMockProvider(new Map());
    }

    default:
      throw new Error(`Unsupported LLM provider: ${provider}. Supported: openai, anthropic, mock`);
  }
}

export { createAnthropicProvider } from "./anthropic.js";
export { createMockProvider } from "./mock.js";
export { createOpenAIProvider } from "./openai.js";
export type { ChatMessage, LLMOpts, LLMProvider } from "./types.js";
