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
    // Give reasoning models (e.g. MiniMax M2) enough budget to emit visible text — a
    // tiny cap makes them spend it all on hidden "thinking" and return no text block.
    await llmProvider.chat([{ role: "user", content: "hi" }], { maxTokens: 256 });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Reaching a "no content" / "empty text content" error means auth, endpoint and a
    // valid response all succeeded — the connection works even if the model emitted no
    // text (e.g. a reasoning model that spent the budget thinking). Treat it as OK.
    if (/returned no content|returned empty text content/i.test(msg)) {
      return { ok: true };
    }
    return { ok: false, error: msg };
  }
}

export async function testEmbeddingConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: "No API key provided" };
  if (!model) return { ok: false, error: "No model provided" };
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: "test" }),
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
