/**
 * Mock LLM Provider for testing
 * Returns predefined responses based on prompt matching
 */

import { ChatMessage, LLMOpts, LLMProvider } from './types';

/**
 * Create a mock LLM provider that returns predefined responses
 * Useful for testing and development without real API calls
 *
 * @param responses - Map of prompt patterns to responses (matched case-insensitively)
 * @returns Mock LLM provider
 */
export function createMockProvider(
  responses: Map<string, string>
): LLMProvider {
  return {
    async chat(messages: ChatMessage[], _opts?: LLMOpts): Promise<string> {
      // Concatenate all message content to form the prompt
      const prompt = messages
        .map((msg) => msg.content)
        .join(' ')
        .toLowerCase();

      // Try to find a matching response
      // First try exact matches, then try partial matches
      for (const [pattern, response] of responses.entries()) {
        if (prompt === pattern.toLowerCase()) {
          return response;
        }
      }

      // Try partial matches (pattern contained in prompt)
      for (const [pattern, response] of responses.entries()) {
        if (pattern === '' || prompt.includes(pattern.toLowerCase())) {
          return response;
        }
      }

      throw new Error(`No mock response found for prompt: "${prompt.substring(0, 100)}..."`);
    },
  };
}
