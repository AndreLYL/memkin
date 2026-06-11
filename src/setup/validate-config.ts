import type {
  EmbeddingConfig,
  FeishuSourceConfig,
  LLMConfig,
  PrivacyConfig,
  SchedulerConfig,
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
  block_builder?: {
    block_gap_minutes?: number;
    max_block_tokens?: number;
    max_block_messages?: number;
  };
  scheduler?: SchedulerConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
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

  return {
    valid: errors.length === 0,
    errors,
  };
}
