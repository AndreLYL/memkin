/**
 * OpenAI-compatible LLM Provider
 * Uses fetch to call OpenAI API directly, supports custom base_url for proxies/local servers.
 * Auto-detects unsupported parameters (temperature, response_format) on first call
 * and falls back gracefully for third-party proxy compatibility.
 */

import type { ChatMessage, LLMOpts, LLMProvider } from "./types.js";

interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface ApiResponse {
  error?: { message: string; type?: string; code?: string };
  choices?: Array<{ message?: { content?: string } }>;
}

export function createOpenAIProvider(config: OpenAIConfig): LLMProvider {
  const { apiKey, model } = config;
  // Normalise base_url: strip trailing slash and trailing /v1 so we always append /v1/...
  const baseUrl = (config.baseUrl ?? "https://api.openai.com")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  // Track which optional features the endpoint supports (auto-detected on first use)
  let supportsTemperature: boolean | null = null;
  let supportsJsonFormat: boolean | null = null;

  async function doFetch(body: Record<string, unknown>): Promise<ApiResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    return (await response.json()) as ApiResponse;
  }

  function buildBody(messages: ChatMessage[], opts?: LLMOpts): Record<string, unknown> {
    const body: Record<string, unknown> = { model, messages };
    if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    if (opts?.temperature !== undefined && supportsTemperature !== false) {
      body.temperature = opts.temperature;
    }
    if (opts?.responseFormat === "json" && supportsJsonFormat !== false) {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  function isApiError(data: ApiResponse): boolean {
    return Boolean(data.error);
  }

  function extractContent(data: ApiResponse): string {
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
  }

  return {
    async chat(messages: ChatMessage[], opts?: LLMOpts): Promise<string> {
      // First attempt: with all supported optional params
      const body = buildBody(messages, opts);
      const data = await doFetch(body);

      if (!isApiError(data)) {
        // Success — mark features as supported if we sent them
        if (body.temperature !== undefined) supportsTemperature = true;
        if (body.response_format !== undefined) supportsJsonFormat = true;
        return extractContent(data);
      }

      // API error — try stripping optional params one at a time
      const errorMsg = data.error?.message ?? "";
      const errorCode = data.error?.code ?? "";
      const errorType = data.error?.type ?? "";

      const isParamError =
        errorCode === "bad_response_status_code" ||
        errorType === "bad_response_status_code" ||
        errorType === "invalid_request_error" ||
        /temperature|response_format|json/i.test(errorMsg);

      if (!isParamError) {
        throw new Error(`API error: ${errorMsg}`);
      }

      // Retry without optional params
      const retryBody: Record<string, unknown> = { model, messages };
      if (opts?.maxTokens !== undefined) retryBody.max_tokens = opts.maxTokens;

      // Try without response_format first (most common culprit)
      if (body.response_format !== undefined) {
        const noFormatBody = { ...body };
        delete noFormatBody.response_format;
        const retryData = await doFetch(noFormatBody);
        if (!isApiError(retryData)) {
          supportsJsonFormat = false;
          if (noFormatBody.temperature !== undefined) supportsTemperature = true;
          return extractContent(retryData);
        }
      }

      // Try with only required params (no temperature, no response_format)
      const minimalData = await doFetch(retryBody);
      if (!isApiError(minimalData)) {
        if (body.temperature !== undefined) supportsTemperature = false;
        if (body.response_format !== undefined) supportsJsonFormat = false;
        return extractContent(minimalData);
      }

      // Everything failed
      throw new Error(`API error: ${minimalData.error?.message ?? errorMsg}`);
    },
  };
}
