/**
 * LLM Provider factory
 * Creates provider instances based on configuration
 */

import type { LLMConfig } from "../../core/config.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createMockProvider } from "./mock.js";
import { createOpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

/**
 * Maps UI-facing provider labels to the canonical provider the factory knows.
 * "Custom / Proxy" (Web UI) and "openai-compatible" (CLI) are both just the
 * OpenAI-compatible protocol with a custom base URL, so they resolve to "openai".
 * Normalizing here — the single choke point every caller funnels through —
 * keeps the alias map authoritative for all entry points (web, CLI, hand-edited
 * config, future clients) instead of scattering it across each UI.
 */
const PROVIDER_ALIASES: Record<string, string> = {
  custom: "openai",
  "openai-compatible": "openai",
};

export function normalizeProvider(raw: string): string {
  return PROVIDER_ALIASES[raw] ?? raw;
}

export function createLLMProvider(config: LLMConfig): LLMProvider {
  const { model, api_key, base_url } = config;
  const provider = normalizeProvider(config.provider);

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
