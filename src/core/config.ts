/**
 * Configuration loader for Memoark
 * Loads YAML config files with environment variable interpolation
 * and recursive merging with defaults
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import type { FeishuDocSourceConfig } from "../collectors/feishu/types.js";

/**
 * Privacy configuration interface
 */
export interface PrivacyConfig {
  enabled: boolean;
  mode: "reversible" | "irreversible";
  redact_phone: boolean;
  redact_id_card: boolean;
  redact_bank_card: boolean;
  redact_email: boolean;
  redact_url: boolean;
  blocked_words: string[];
  replacement: string;
}

/**
 * LLM provider configuration interface
 */
export interface LLMConfig {
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
  filter_model?: string;
  filter_provider?: string;
}

/**
 * Block builder configuration interface
 */
export interface BlockBuilderConfig {
  block_gap_minutes: number;
  max_block_tokens: number;
  max_block_messages: number;
}

/**
 * Adapter configuration for file and gbrain
 */
export interface AdapterConfig {
  enabled: boolean;
  output_dir: string;
}

/**
 * Adapters configuration interface
 */
export interface AdaptersConfig {
  file?: AdapterConfig;
  gbrain?: AdapterConfig;
}

/**
 * Source configuration for each data source
 */
export interface SourceConfig {
  enabled: boolean;
  base_dir?: string;
}

/**
 * Sources configuration interface
 */
export interface FeishuSourceConfig {
  enabled?: boolean;
  auth_mode?: "bot" | "user";
  app_id: string;
  app_secret: string;
  lark_bin?: string;
  auto_include_new_groups?: boolean;
  base_url?: string;
  rate_limit_qps?: number;
  sources: {
    messages?: {
      enabled: boolean;
      chat_ids: string[];
      lookback_days?: number;
      overlap_ms?: number;
    };
    calendar?: { enabled: boolean; calendar_ids: string[] };
    docs?: FeishuDocSourceConfig;
    tasks?: { enabled: boolean };
    dm?: {
      enabled: boolean;
      dm_chat_ids?: string[];
      self_open_id?: string;
      lookback_days?: number;
      overlap_ms?: number;
    };
    message_search?: {
      enabled: boolean;
      chat_types?: Array<"p2p" | "group">;
      query?: string;
      sender_type?: "user" | "bot";
      exclude_sender_type?: "user" | "bot";
      lookback_days?: number;
      overlap_ms?: number;
      page_size?: number;
    };
    mail?: {
      enabled: boolean;
      lookback_days?: number;
      overlap_ms?: number;
      fetch_concurrency?: number;
    };
  };
}

export interface SourcesConfig {
  "claude-code"?: SourceConfig;
  codex?: SourceConfig;
  hermes?: SourceConfig;
  feishu?: FeishuSourceConfig;
}

/**
 * Store configuration for data persistence
 */
export interface StoreConfig {
  data_dir: string;
}

/**
 * Embedding configuration for vector storage
 */
export interface EmbeddingConfig {
  provider: "openai" | "ollama";
  model: string;
  dimensions: number;
  api_key?: string;
  base_url?: string;
}

/**
 * Server configuration for HTTP and MCP
 */
export interface ServerConfig {
  http_port: number;
  mcp_transport: "stdio" | "sse" | "streamable_http";
}

export interface McpHttpConfig {
  enabled: boolean;
  bind_host: string;
  port: number;
  allowed_origins: string[];
  allowed_hosts: string[];
  auth_token_env?: string;
  read_only: boolean;
}

export interface McpConfig {
  expose_legacy_tools: boolean;
  http: McpHttpConfig;
}

export interface SchedulerSourceConfig {
  enabled?: boolean;
  interval_secs?: number;
}

export interface SchedulerConfig {
  enabled: boolean;
  tick_interval_secs: number;
  defaults: { interval_secs: number };
  sources: Record<string, SchedulerSourceConfig>;
}

export interface PipelineOptsConfig {
  block_concurrency?: number;
}

/**
 * Complete configuration interface
 */
export interface Config {
  privacy: PrivacyConfig;
  llm: LLMConfig;
  block_builder: BlockBuilderConfig;
  adapters: AdaptersConfig;
  sources: SourcesConfig;
  store: StoreConfig;
  embedding: EmbeddingConfig;
  server: ServerConfig;
  mcp: McpConfig;
  scheduler?: SchedulerConfig;
  pipeline?: PipelineOptsConfig;
}

export interface ConfigContext {
  readonly configPath: string;
  readonly projectRoot: string;
  readonly missingEnvVars: string[];
}

export interface LoadedConfig extends Config {
  readonly __context: ConfigContext;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
  privacy: {
    enabled: true,
    mode: "reversible",
    redact_phone: true,
    redact_id_card: true,
    redact_bank_card: true,
    redact_email: false,
    redact_url: false,
    blocked_words: [],
    replacement: "[REDACTED]",
  },
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
  },
  block_builder: {
    block_gap_minutes: 30,
    max_block_tokens: 4000,
    max_block_messages: 100,
  },
  adapters: {},
  sources: {
    "claude-code": { enabled: true },
    codex: { enabled: true },
    hermes: { enabled: true },
  },
  store: {
    data_dir: "~/.memoark/data",
  },
  embedding: {
    provider: "openai",
    model: "text-embedding-3-large",
    dimensions: 768,
  },
  server: {
    http_port: 3927,
    mcp_transport: "stdio",
  },
  mcp: {
    expose_legacy_tools: false,
    http: {
      enabled: false,
      bind_host: "127.0.0.1",
      port: 3928,
      allowed_origins: ["http://127.0.0.1:3928", "http://localhost:3928"],
      allowed_hosts: ["127.0.0.1:3928", "localhost:3928"],
      auth_token_env: "",
      read_only: true,
    },
  },
};

/**
 * Recursively interpolate environment variables in an object
 * Replaces ${VAR_NAME} with process.env.VAR_NAME
 * If VAR_NAME is not found, keeps the placeholder and records the variable name
 *
 * @param obj - Object to interpolate
 * @returns Object with interpolated values and missing variable names
 */
function interpolateEnv(obj: unknown): { result: unknown; missing: string[] } {
  const missing = new Set<string>();

  function walk(value: unknown): unknown {
    if (typeof value === "string") {
      return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, varName) => {
        const envValue = process.env[varName];
        if (envValue === undefined) {
          missing.add(varName);
          return match;
        }
        return envValue;
      });
    }

    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        result[key] = walk(nestedValue);
      }
      return result;
    }

    return value;
  }

  return { result: walk(obj), missing: Array.from(missing).sort() };
}

function attachContext(config: Config, context: ConfigContext): LoadedConfig {
  return Object.defineProperty(config, "__context", {
    value: context,
    enumerable: false,
    configurable: false,
    writable: false,
  }) as LoadedConfig;
}

export function resolveConfigPath(explicit?: string): string {
  if (explicit) return resolve(explicit);

  const envPath = process.env.MEMOARK_CONFIG;
  if (envPath) return resolve(envPath);

  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, "memoark.yaml");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(process.cwd(), "memoark.yaml");
}

/**
 * Deep merge user config into defaults
 * User values override defaults at all levels
 *
 * @param defaults - Default configuration
 * @param user - User-provided configuration
 * @returns Merged configuration
 */
function mergeConfig(
  defaults: Record<string, unknown>,
  user: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...defaults };

  for (const key in user) {
    const userValue = user[key];
    const defaultValue = defaults[key];

    // If user value is an object and default exists and is an object, merge recursively
    if (
      userValue !== null &&
      typeof userValue === "object" &&
      !Array.isArray(userValue) &&
      defaultValue !== null &&
      typeof defaultValue === "object" &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = mergeConfig(
        defaultValue as Record<string, unknown>,
        userValue as Record<string, unknown>,
      );
    } else {
      // Otherwise, user value overrides default
      result[key] = userValue;
    }
  }

  return result;
}

/**
 * Load configuration from YAML file
 * Performs environment variable interpolation and merges with defaults
 *
 * @param filePath - Path to YAML config file (default: discovered memoark.yaml)
 * @returns Loaded and merged configuration
 * @throws Error if file cannot be read or parsed
 */
export function loadConfig(filePath?: string): LoadedConfig {
  const configPath = resolveConfigPath(filePath);
  const projectRoot = dirname(configPath);

  let userConfig: Record<string, unknown> = {};

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = parse(content);
    userConfig = parsed || {};
  } catch (error) {
    // If file doesn't exist or can't be read, use empty config (will use defaults)
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const interpolated = interpolateEnv(userConfig);
  userConfig = interpolated.result as Record<string, unknown>;

  // Merge with defaults
  const merged = mergeConfig(DEFAULT_CONFIG as unknown as Record<string, unknown>, userConfig);

  return attachContext(merged as unknown as Config, {
    configPath,
    projectRoot,
    missingEnvVars: interpolated.missing,
  });
}
