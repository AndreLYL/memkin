/**
 * LLM Provider factory
 * Creates provider instances based on configuration
 */

import { LLMConfig } from '../../../core/config';
import { LLMProvider } from './types';
import { createOpenAIProvider } from './openai';
import { createMockProvider } from './mock';

/**
 * Create an LLM provider based on configuration
 * Supports: 'openai' (default), 'mock', or any OpenAI-compatible API
 *
 * @param config - LLM configuration
 * @returns LLM provider instance
 * @throws Error if provider type is not supported or config is invalid
 */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  const { provider, model, api_key, base_url } = config;

  switch (provider) {
    case 'openai': {
      if (!api_key) {
        throw new Error('OpenAI provider requires api_key in config');
      }
      return createOpenAIProvider({
        apiKey: api_key,
        model,
        baseUrl: base_url,
      });
    }

    case 'mock': {
      // For mock provider, create with empty responses by default
      // Caller can instantiate directly if custom responses needed
      return createMockProvider(new Map());
    }

    default:
      throw new Error(
        `Unsupported LLM provider: ${provider}. Supported: openai, mock`
      );
  }
}

export { createOpenAIProvider } from './openai';
export { createMockProvider } from './mock';
export type { LLMProvider, ChatMessage, LLMOpts } from './types';
