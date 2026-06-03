/**
 * OpenAI-compatible LLM Provider
 * Uses fetch to call OpenAI API directly, supports custom base_url for proxies/local servers
 */

import type { ChatMessage, LLMOpts, LLMProvider } from "./types";

interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const { apiKey, model, baseUrl = "https://api.openai.com" } = config;

  return {
    async chat(messages: ChatMessage[], opts?: LLMOpts): Promise<string> {
      const url = `${baseUrl}/v1/chat/completions`;

      // Build request body
      const requestBody: Record<string, unknown> = {
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

      let lastError: unknown;

      for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          const raw = await response.text();
          let data: {
            error?: { message: string };
            choices?: Array<{ message?: { content?: string } }>;
          };

          try {
            data = JSON.parse(raw);
          } catch {
            throw new Error(`API returned non-JSON response: ${raw.slice(0, 300)}`);
          }

          if (!response.ok) {
            const message = data.error?.message ?? raw.slice(0, 300) ?? response.statusText;
            throw new Error(`API HTTP ${response.status}: ${message}`);
          }

          // Check for API errors
          if (data.error) {
            throw new Error(`API error: ${data.error.message}`);
          }

          // Check for valid response structure
          if (!data.choices || data.choices.length === 0) {
            throw new Error("API returned no choices in response");
          }

          const choice = data.choices[0];
          if (!choice.message) {
            throw new Error("API response choice has no message");
          }

          let content = choice.message.content ?? "";
          content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
          return content;
        } catch (error) {
          lastError = error;
          if (attempt >= DEFAULT_MAX_RETRIES) break;
          await sleep(1000 * 2 ** attempt);
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new Error(
        `API request failed after ${DEFAULT_MAX_RETRIES + 1} attempts: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    },
  };
}
