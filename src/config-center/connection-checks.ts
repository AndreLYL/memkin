import {
  type LLMConnectionConfig,
  testEmbeddingConnection,
  testLLMConnection,
} from "../setup/connection-tests.js";
import type { ConfigDraft } from "./document.js";

export type ConnectionCheckStatus = "checking" | "failed" | "idle" | "incomplete" | "ok";

export interface ConnectionStatusItem {
  status: ConnectionCheckStatus;
  message?: string;
}

export interface ConnectionStatusState {
  llm: ConnectionStatusItem;
  embedding: ConnectionStatusItem;
}

export interface EmbeddingConnectionConfig {
  provider: "ollama" | "openai";
  model: string;
  dimensions: number;
  baseUrl: string;
  apiKey?: string;
}

export interface ConnectionCheckPlan {
  llm?: LLMConnectionConfig;
  embedding?: EmbeddingConnectionConfig;
}

export const DEFAULT_CONNECTION_STATUS: ConnectionStatusState = {
  llm: { status: "idle" },
  embedding: { status: "idle" },
};

const ENV_PLACEHOLDER_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

function resolveEnvPlaceholder(value: string | undefined, env: NodeJS.ProcessEnv): string {
  if (!value) return "";
  const match = value.trim().match(ENV_PLACEHOLDER_RE);
  if (!match) return value.trim();
  return env[match[1]]?.trim() ?? "";
}

function present(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0);
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildConnectionCheckPlan(
  draft: ConfigDraft,
  env: NodeJS.ProcessEnv = process.env,
): ConnectionCheckPlan {
  const llmProvider = draft.llm?.provider?.trim();
  const llmModel = draft.llm?.model?.trim();
  const llmBaseUrl = draft.llm?.base_url?.trim();
  const llmApiKey = resolveEnvPlaceholder(draft.llm?.api_key, env);
  const embeddingProvider = draft.embedding?.provider;
  const embeddingModel = draft.embedding?.model?.trim();
  const embeddingDimensions = draft.embedding?.dimensions;
  const embeddingBaseUrl = draft.embedding?.base_url?.trim();
  const embeddingApiKey = resolveEnvPlaceholder(draft.embedding?.api_key, env);
  const plan: ConnectionCheckPlan = {};

  if (present(llmProvider) && present(llmModel) && present(llmBaseUrl) && present(llmApiKey)) {
    plan.llm = {
      provider: llmProvider,
      model: llmModel,
      baseUrl: llmBaseUrl,
      apiKey: llmApiKey,
    };
  }

  if (embeddingProvider === "openai") {
    if (
      present(embeddingModel) &&
      positiveNumber(embeddingDimensions) &&
      present(embeddingBaseUrl) &&
      present(embeddingApiKey)
    ) {
      plan.embedding = {
        provider: "openai",
        model: embeddingModel,
        dimensions: embeddingDimensions,
        baseUrl: embeddingBaseUrl,
        apiKey: embeddingApiKey,
      };
    }
  } else if (embeddingProvider === "ollama") {
    if (
      present(embeddingModel) &&
      positiveNumber(embeddingDimensions) &&
      present(embeddingBaseUrl)
    ) {
      plan.embedding = {
        provider: "ollama",
        model: embeddingModel,
        dimensions: embeddingDimensions,
        baseUrl: embeddingBaseUrl,
      };
    }
  }

  return plan;
}

export function connectionCheckSignature(plan: ConnectionCheckPlan): string {
  return JSON.stringify(plan);
}

export function formatConnectionItem(item: ConnectionStatusItem): string {
  switch (item.status) {
    case "checking":
      return "checking...";
    case "failed":
      return `failed${item.message ? `: ${item.message}` : ""}`;
    case "incomplete":
      return "incomplete";
    case "ok":
      return "ok";
    case "idle":
      return "not checked";
  }
}

async function testOllamaEmbeddingConnection(
  config: EmbeddingConnectionConfig,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, error: `Ollama responded with ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const found = (data.models ?? []).some((model) => model.name.startsWith(config.model));
    return found ? { ok: true } : { ok: false, error: `Model ${config.model} not found` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runConnectionCheckPlan(
  plan: ConnectionCheckPlan,
): Promise<Partial<ConnectionStatusState>> {
  const next: Partial<ConnectionStatusState> = {};

  if (plan.llm) {
    const result = await testLLMConnection(plan.llm);
    next.llm = result.ok ? { status: "ok" } : { status: "failed", message: result.error };
  }

  if (plan.embedding) {
    const result =
      plan.embedding.provider === "ollama"
        ? await testOllamaEmbeddingConnection(plan.embedding)
        : await testEmbeddingConnection(
            plan.embedding.baseUrl,
            plan.embedding.apiKey ?? "",
            plan.embedding.model,
          );
    next.embedding = result.ok ? { status: "ok" } : { status: "failed", message: result.error };
  }

  return next;
}
