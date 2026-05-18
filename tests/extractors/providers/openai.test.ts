import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOpenAIProvider } from '../../../src/extractors/providers/openai';
import { createMockProvider } from '../../../src/extractors/providers/mock';

describe('LLM Providers', () => {
  describe('Mock Provider', () => {
    it('should return predefined response for matching prompt', async () => {
      const responses = new Map([
        ['hello', 'Hello, friend!'],
        ['what is your name', 'I am an AI assistant'],
      ]);

      const provider = createMockProvider(responses);
      const result = await provider.chat([
        { role: 'user', content: 'hello' },
      ]);

      expect(result).toBe('Hello, friend!');
    });

    it('should match prompts case-insensitively', async () => {
      const responses = new Map([['HELLO', 'Hi there!']]);
      const provider = createMockProvider(responses);

      const result = await provider.chat([
        { role: 'user', content: 'hello' },
      ]);

      expect(result).toBe('Hi there!');
    });

    it('should return first matching response with partial match', async () => {
      const responses = new Map([
        ['hello world', 'Full match response'],
        ['hello', 'Partial match response'],
      ]);

      const provider = createMockProvider(responses);
      const result = await provider.chat([
        { role: 'user', content: 'hello world' },
      ]);

      expect(result).toBe('Full match response');
    });

    it('should handle multiple messages by concatenating content', async () => {
      const responses = new Map([
        ['system instruction user prompt', 'Combined response'],
      ]);

      const provider = createMockProvider(responses);
      const result = await provider.chat([
        { role: 'system', content: 'system instruction' },
        { role: 'user', content: 'user prompt' },
      ]);

      expect(result).toBe('Combined response');
    });

    it('should throw error if no matching response found', async () => {
      const responses = new Map([['hello', 'Hi']]);
      const provider = createMockProvider(responses);

      await expect(
        provider.chat([{ role: 'user', content: 'goodbye' }])
      ).rejects.toThrow('No mock response found for prompt');
    });

    it('should respect response format option (but mock always returns string)', async () => {
      const responses = new Map([['test', 'response']]);
      const provider = createMockProvider(responses);

      const result = await provider.chat(
        [{ role: 'user', content: 'test' }],
        { responseFormat: 'json' }
      );

      expect(result).toBe('response');
    });

    it('should accept temperature and maxTokens options without error', async () => {
      const responses = new Map([['test', 'response']]);
      const provider = createMockProvider(responses);

      const result = await provider.chat(
        [{ role: 'user', content: 'test' }],
        { temperature: 0.7, maxTokens: 1000 }
      );

      expect(result).toBe('response');
    });
  });

  describe('OpenAI Provider', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should construct correct request body for chat completion', async () => {
      let capturedRequest: RequestInit | undefined;
      let capturedUrl: string | undefined;

      global.fetch = vi.fn(async (url, options) => {
        capturedUrl = url as string;
        capturedRequest = options;

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'test response' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      const result = await provider.chat([
        { role: 'user', content: 'Hello, AI!' },
      ]);

      expect(result).toBe('test response');
      expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
      expect(capturedRequest?.method).toBe('POST');
      expect(capturedRequest?.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      });

      const body = JSON.parse(capturedRequest?.body as string);
      expect(body).toEqual({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello, AI!' }],
        temperature: undefined,
        max_tokens: undefined,
        response_format: undefined,
      });
    });

    it('should use custom base_url when provided', async () => {
      let capturedUrl: string | undefined;

      global.fetch = vi.fn(async (url) => {
        capturedUrl = url as string;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'response' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
        baseUrl: 'https://api.anthropic.com',
      });

      await provider.chat([{ role: 'user', content: 'test' }]);

      expect(capturedUrl).toBe(
        'https://api.anthropic.com/v1/chat/completions'
      );
    });

    it('should include temperature in request when provided', async () => {
      let capturedBody: any;

      global.fetch = vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'response' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      await provider.chat([{ role: 'user', content: 'test' }], {
        temperature: 0.5,
      });

      expect(capturedBody.temperature).toBe(0.5);
    });

    it('should include maxTokens in request as max_tokens', async () => {
      let capturedBody: any;

      global.fetch = vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'response' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      await provider.chat([{ role: 'user', content: 'test' }], {
        maxTokens: 2000,
      });

      expect(capturedBody.max_tokens).toBe(2000);
    });

    it('should include response_format in request when responseFormat is json', async () => {
      let capturedBody: any;

      global.fetch = vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{}' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      await provider.chat([{ role: 'user', content: 'test' }], {
        responseFormat: 'json',
      });

      expect(capturedBody.response_format).toEqual({ type: 'json_object' });
    });

    it('should not include response_format in request when responseFormat is text', async () => {
      let capturedBody: any;

      global.fetch = vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'response' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      await provider.chat([{ role: 'user', content: 'test' }], {
        responseFormat: 'text',
      });

      expect(capturedBody.response_format).toBeUndefined();
    });

    it('should extract message content from API response', async () => {
      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Extracted content' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      const result = await provider.chat([
        { role: 'user', content: 'test' },
      ]);

      expect(result).toBe('Extracted content');
    });

    it('should handle multiple system, user, and assistant messages', async () => {
      let capturedBody: any;

      global.fetch = vi.fn(async (url, options) => {
        capturedBody = JSON.parse(options?.body as string);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'response' } }],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      const messages = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there' },
        { role: 'user' as const, content: 'How are you?' },
      ];

      await provider.chat(messages);

      expect(capturedBody.messages).toEqual(messages);
    });

    it('should throw error if API returns error response', async () => {
      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: { message: 'Invalid API key' },
          }),
          { status: 401 }
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'bad-key',
        model: 'gpt-4',
      });

      await expect(
        provider.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow(/API error|failed/i);
    });

    it('should throw error if response has no choices', async () => {
      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      await expect(
        provider.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow(/no choices|empty/i);
    });

    it('should throw error if response choice has no message', async () => {
      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [{}],
          })
        );
      });

      const provider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4',
      });

      await expect(
        provider.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow(/message/i);
    });
  });
});
