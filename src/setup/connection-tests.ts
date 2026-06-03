import { createLLMProvider } from "../extractors/providers/index.js";

export interface LLMConnectionConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export async function testLLMConnection(
  cfg: LLMConnectionConfig,
): Promise<{ ok: boolean; error?: string }> {
  if (cfg.provider === "mock") return { ok: true };
  if (!cfg.apiKey) return { ok: false, error: "No API key provided" };

  try {
    const llmProvider = createLLMProvider({
      provider: cfg.provider,
      model: cfg.model,
      base_url: cfg.baseUrl,
      api_key: cfg.apiKey,
    });
    await llmProvider.chat([{ role: "user", content: "hi" }], { maxTokens: 5 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function testEmbeddingConnection(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: "No API key provided" };
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-large", input: "test" }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { error?: { message: string } };
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkOllamaModel(model: string): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).some((m) => m.name.startsWith(model));
  } catch {
    return false;
  }
}
