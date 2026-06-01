/**
 * Anthropic-compatible LLM Provider
 * Uses fetch to call Anthropic Messages API directly
 */

import type { ChatMessage, LLMOpts, LLMProvider } from "./types.js";

interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function createAnthropicProvider(config: AnthropicConfig): LLMProvider {
  const { apiKey, model, baseUrl = "https://api.anthropic.com" } = config;

  return {
    async chat(messages: ChatMessage[], opts?: LLMOpts): Promise<string> {
      const url = `${baseUrl}/v1/messages`;

      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");

      const anthropicMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const requestBody: Record<string, unknown> = {
        model,
        messages: anthropicMessages,
        max_tokens: opts?.maxTokens ?? 4096,
        thinking: { type: "disabled" },
      };

      if (system) requestBody.system = system;
      if (opts?.temperature !== undefined) requestBody.temperature = opts.temperature;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (err) {
        throw new Error(
          `Anthropic API request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      const data = (await response.json()) as {
        error?: { message: string };
        content?: Array<{ type: string; text?: string }>;
      };

      if (data.error) {
        throw new Error(`Anthropic API error: ${data.error.message}`);
      }

      if (!data.content || data.content.length === 0) {
        throw new Error("Anthropic API returned no content");
      }

      let content = data.content
        .filter((b) => b.type === "text" && b.text && b.text.trim().length > 0)
        .map((b) => b.text ?? "")
        .join("");

      content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

      if (!content) {
        throw new Error("Anthropic API returned empty text content");
      }

      return content;
    },
  };
}
