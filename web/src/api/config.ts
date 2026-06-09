const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface WizardLLMConfig {
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
}

export interface WizardEmbeddingConfig {
  provider: "openai" | "ollama";
  model: string;
  dimensions: number;
  base_url?: string;
  api_key?: string;
}

export interface WizardFeishuSources {
  dm?: boolean;
  messages?: boolean;
  mail?: boolean;
  docs?: boolean;
  tasks?: boolean;
  calendar?: boolean;
}

export interface WizardFeishuConfig {
  enabled?: boolean;
  app_id?: string;
  app_secret?: string;
  lark_bin?: string;
  sources?: WizardFeishuSources;
  chat_ids?: string[];
}

export interface SchedulerSourceConfig {
  enabled?: boolean;
  interval_secs?: number;
}

export interface SchedulerConfig {
  enabled?: boolean;
  tick_interval_secs?: number;
  defaults?: { interval_secs?: number };
  sources?: Record<string, SchedulerSourceConfig>;
}

export interface WizardConfig {
  llm?: WizardLLMConfig;
  embedding?: WizardEmbeddingConfig;
  sources?: {
    "claude-code"?: { enabled: boolean };
    feishu?: WizardFeishuConfig;
  };
  store?: { data_dir?: string };
  adapters?: { file?: { enabled: boolean; output_dir: string } };
  scheduler?: SchedulerConfig;
}

export interface ConfigDiagnostic {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface FeishuGroup {
  id: string;
  name: string;
}

export const configApi = {
  getConfig: (): Promise<WizardConfig> =>
    fetchJSON<WizardConfig>("/config"),

  saveConfig: (config: WizardConfig): Promise<{ ok: boolean; diagnostics: ConfigDiagnostic[] }> =>
    fetchJSON("/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }),

  testLLM: (cfg: WizardLLMConfig): Promise<{ ok: boolean; latency_ms: number; error?: string }> =>
    fetchJSON("/test/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    }),

  testEmbedding: (cfg: {
    provider: string;
    base_url?: string;
    api_key?: string;
  }): Promise<{ ok: boolean; error?: string }> =>
    fetchJSON("/test/embedding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    }),

  feishuHealth: (): Promise<{ ok: boolean; message: string }> =>
    fetchJSON("/feishu/health"),

  feishuGroups: (): Promise<{ groups?: FeishuGroup[]; error?: string }> =>
    fetchJSON("/feishu/groups"),

  setupComplete: (): Promise<Response> =>
    fetch(`${BASE}/setup/complete`, { method: "POST" }),
};
