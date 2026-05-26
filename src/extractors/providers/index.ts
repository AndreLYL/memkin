/**
 * LLM Provider factory
 * Creates provider instances based on configuration
 */

import type { LLMConfig } from "../../core/config";
import { createAnthropicProvider } from "./anthropic";
import { createMockProvider } from "./mock";
import { createOpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";

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

export { createAnthropicProvider } from "./anthropic";
export { createMockProvider } from "./mock";
export { createOpenAIProvider } from "./openai";
export type { ChatMessage, LLMOpts, LLMProvider } from "./types";
