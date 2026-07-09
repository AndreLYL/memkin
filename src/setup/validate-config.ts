import type {
  DistillerConfig,
  EmbeddingConfig,
  FeishuSourceConfig,
  LLMConfig,
  McpConfig,
  PrivacyConfig,
  ProfileConfig,
  SchedulerConfig,
  SearchConfig,
  ServerConfig,
  SourceConfig,
  StoreConfig,
} from "../core/config.js";

export interface PartialSourcesConfig {
  "claude-code"?: Partial<SourceConfig>;
  codex?: Partial<SourceConfig>;
  hermes?: Partial<SourceConfig>;
  feishu?: Partial<FeishuSourceConfig>;
}

export interface PartialConfig {
  llm?: Partial<LLMConfig>;
  sources?: PartialSourcesConfig;
  privacy?: Partial<PrivacyConfig>;
  store?: Partial<StoreConfig>;
  embedding?: Partial<EmbeddingConfig>;
  server?: Partial<ServerConfig>;
  mcp?: Partial<McpConfig>;
  block_builder?: {
    block_gap_minutes?: number;
    max_block_tokens?: number;
    max_block_messages?: number;
  };
  scheduler?: SchedulerConfig;
  profile?: Partial<ProfileConfig>;
  search?: Partial<SearchConfig>;
  distiller?: Partial<DistillerConfig>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isPublicBindHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized);
}

export function validateConfig(config: PartialConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.llm?.provider) {
    errors.push("LLM provider is required");
  }
  if (!config.llm?.model) {
    errors.push("LLM model is required");
  }

  const hasEnabledSource = Object.values(config.sources || {}).some(
    (source) =>
      source && typeof source === "object" && "enabled" in source && source.enabled === true,
  );
  if (!hasEnabledSource) {
    errors.push("At least one data source must be enabled");
  }

  const feishu = config.sources?.feishu;
  if (feishu?.enabled) {
    if (!feishu.app_id) {
      errors.push("Feishu App ID is required when Feishu is enabled");
    }
    if (!feishu.app_secret) {
      errors.push("Feishu App Secret is required when Feishu is enabled");
    }
  }

  const mcpHttp = config.mcp?.http;
  if (mcpHttp?.enabled) {
    if (!mcpHttp.allowed_origins || mcpHttp.allowed_origins.length === 0) {
      errors.push("MCP HTTP allowed_origins must contain at least one trusted origin");
    }
    if (!mcpHttp.allowed_hosts || mcpHttp.allowed_hosts.length === 0) {
      errors.push("MCP HTTP allowed_hosts must contain at least one trusted host");
    }
    if (isPublicBindHost(mcpHttp.bind_host) && !mcpHttp.auth_token_env) {
      errors.push("MCP HTTP public bind requires auth_token_env");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
