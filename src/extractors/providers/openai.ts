/**
 * OpenAI-compatible LLM Provider
 * Uses fetch to call OpenAI API directly, supports custom base_url for proxies/local servers
 */

import { ChatMessage, LLMOpts, LLMProvider } from './types';

interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * Create an OpenAI-compatible LLM provider
 * Supports OpenAI API, Anthropic proxy, Ollama, TokenFree, and other compatible services
 *
 * @param config - Configuration object
 * @param config.apiKey - API key for authentication
 * @param config.model - Model name (e.g. 'gpt-4', 'gpt-4o-mini')
 * @param config.baseUrl - Base URL for API (default: https://api.openai.com)
 * @returns OpenAI-compatible LLM provider
 */
export function createOpenAIProvider(config: OpenAIConfig): LLMProvider {
  const { apiKey, model, baseUrl = 'https://api.openai.com' } = config;

  return {
    async chat(
      messages: ChatMessage[],
      opts?: LLMOpts
    ): Promise<string> {
      const url = `${baseUrl}/v1/chat/completions`;

      // Build request body
      const requestBody: Record<string, any> = {
        model,
        messages,
      };

      // Add optional parameters if provided
      if (opts?.temperature !== undefined) {
        requestBody.temperature = opts.temperature;
      }

      if (opts?.maxTokens !== undefined) {
        requestBody.max_tokens = opts.maxTokens;
      }

      if (opts?.responseFormat === 'json') {
        requestBody.response_format = { type: 'json_object' };
      }

      // Make the API call
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      const data = (await response.json()) as any;

      // Check for API errors
      if (data.error) {
        throw new Error(`API error: ${data.error.message}`);
      }

      // Check for valid response structure
      if (!data.choices || data.choices.length === 0) {
        throw new Error('API returned no choices in response');
      }

      const choice = data.choices[0];
      if (!choice.message) {
        throw new Error('API response choice has no message');
      }

      let content = choice.message.content ?? '';
      content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
      const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (codeBlockMatch) content = codeBlockMatch[1].trim();
      return content;
    },
  };
}
