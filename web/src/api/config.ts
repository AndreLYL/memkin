const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface DaemonStatus {
  running: boolean;
  uptime_seconds: number | null;
  last_run: string | null;
  next_scheduled: string | null;
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
  auto_include_new_groups?: boolean;
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
    codex?: { enabled: boolean };
    hermes?: { enabled: boolean };
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

export interface RefreshStatus {
  jobId: string | null;
  state: "idle" | "running" | "done" | "error";
  total: number;
  resolved: number;
  failed: number;
  skipped: number;
  currentChannel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errors: Array<{ channel: string; error: string }>;
  lastRefreshedAt: string | null;
}

export interface ChannelNameResult {
  display_name: string | null;
  status: "resolved" | "unresolved" | "failed" | "mail";
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
    model?: string;
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

  // In-wizard Feishu device-flow authorization. start/complete use raw fetch so a
  // non-2xx JSON error body (e.g. lark not installed) survives instead of throwing.
  feishuAuthStatus: (): Promise<{
    ready: boolean;
    notInstalled: boolean;
    userName?: string;
  }> => fetchJSON("/feishu/auth/status"),

  feishuAuthStart: (): Promise<{
    verification_url?: string;
    device_code?: string;
    error?: string;
    notInstalled?: boolean;
  }> => fetch(`${BASE}/feishu/auth/start`, { method: "POST" }).then((r) => r.json()),

  feishuAuthComplete: (deviceCode: string): Promise<{ ok: boolean; error?: string }> =>
    fetch(`${BASE}/feishu/auth/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    }).then((r) => r.json()),

  feishuGroups: (): Promise<{ groups?: FeishuGroup[]; error?: string }> =>
    fetchJSON("/feishu/groups"),

  refreshChatNames: (): Promise<{ jobId?: string; error?: string }> =>
    fetch(`${BASE}/feishu/refresh-chat-names`, { method: "POST" }).then((r) => r.json()),

  getRefreshStatus: (): Promise<RefreshStatus> => fetchJSON("/feishu/refresh-chat-names/status"),

  getChannelNames: (
    channels: string[],
  ): Promise<{ results: Record<string, ChannelNameResult> }> =>
    fetchJSON("/feishu/channel-names", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channels }),
    }),

  setupComplete: (): Promise<Response> =>
    fetch(`${BASE}/setup/complete`, { method: "POST" }),

  getDaemonStatus: (): Promise<DaemonStatus> =>
    fetchJSON<{ daemon: DaemonStatus }>("/health").then((r) => r.daemon),
};
