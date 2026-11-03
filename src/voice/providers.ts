import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LLMProvider } from "../extractors/providers/types.js";
import { type Transcript, TranscriptSchema } from "./transcript.js";

export interface AudioProvider {
  reviewedTranscript?: Transcript;
  transcribe(audioPath: string): Promise<Transcript>;
}

export function localPythonProvider(options: {
  python: string;
  script: string;
  modelDir: string;
  language?: string;
  device?: "cpu" | "cuda";
}): AudioProvider {
  return {
    async transcribe(audioPath) {
      const { stdout } = await promisify(execFile)(
        options.python,
        [
          options.script,
          "transcribe",
          "--audio",
          audioPath,
          "--model-dir",
          options.modelDir,
          "--language",
          options.language ?? "zh",
          "--device",
          options.device ?? "cpu",
        ],
        {
          shell: false,
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024,
          timeout: 6 * 60 * 60 * 1000,
          env: {
            ...process.env,
            HF_HUB_OFFLINE: "1",
            HF_HUB_DISABLE_TELEMETRY: "1",
            PYTHONUTF8: "1",
          },
        },
      );
      return TranscriptSchema.parse(JSON.parse(stdout));
    },
  };
}

export function assertLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Voice P0 only accepts explicit loopback addresses (127.0.0.1 or [::1])");
  }
  return url;
}

/** Does not consult Memkin's existing cloud provider settings or API keys. */
export function localOllamaProvider(
  model: string,
  baseUrl = "http://127.0.0.1:11434",
): LLMProvider {
  const url = assertLoopbackUrl(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Expected an HTTP Ollama URL");
  if (!model.trim() || /cloud/i.test(model))
    throw new Error("Choose a downloaded local Ollama model, not a cloud model");
  return {
    async chat(messages, opts) {
      const show = await fetch(new URL("/api/show", url), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!show.ok)
        throw new Error(
          "Local model is unavailable; download it separately before processing recordings",
        );
      const modelInfo = (await show.json()) as { remote_host?: unknown; remote_model?: unknown };
      if (modelInfo.remote_host || modelInfo.remote_model)
        throw new Error("Remote Ollama models are disabled for Voice P0");
      const response = await fetch(new URL("/api/chat", url), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10 * 60 * 1000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          think: false,
          format: opts?.responseFormat === "json" ? "json" : undefined,
          options: {
            temperature: opts?.temperature ?? 0,
            num_predict: opts?.maxTokens ?? 6000,
            num_ctx: 32768,
          },
        }),
      });
      if (!response.ok) throw new Error(`Local Ollama returned HTTP ${response.status}`);
      const result = (await response.json()) as { message?: { content?: unknown }; done?: boolean };
      if (result.done !== true || typeof result.message?.content !== "string")
        throw new Error("Invalid or incomplete local model response");
      return result.message.content;
    },
  };
}
