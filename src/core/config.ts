/**
 * Configuration loader for Memkin
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
 * Managed postgres sub-configuration (engine: managed).
 * The database_url is derived at runtime; no explicit URL is needed.
 */
export interface ManagedStoreConfig {
  // override for the Postgres runtime root (binaries + extensions); same as MEMKIN_PG_RUNTIME_DIR
  runtime_dir?: string;
}

/**
 * Store configuration for data persistence
 */
export interface StoreConfig {
  engine?: "pglite" | "postgres" | "managed"; // 默认 pglite
  data_dir?: string; // engine: pglite（改为可选）
  database_url?: string; // engine: postgres，支持 ${ENV}
  pool_size?: number; // 可选，默认 10
  managed?: ManagedStoreConfig; // engine: managed
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
  /**
   * Bind host for the `serve` HTTP API + Web UI. Defaults to loopback
   * (127.0.0.1). Setting a non-loopback host (e.g. 0.0.0.0) requires an auth
   * token; the CLI `--host` flag overrides this.
   */
  host?: string;
  /**
   * Bearer token required on `/api/*` and `/mcp`. When set, auth is enforced on
   * every interface (including loopback). Env `MEMKIN_AUTH_TOKEN` overrides.
   * Required whenever `host` is non-loopback.
   */
  auth_token?: string;
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
  /**
   * Hard per-source run timeout in milliseconds. A source that exceeds it is
   * recorded as failed and the tick moves on to the next source, so one wedged
   * source cannot stall the whole scheduler. Default: 10 minutes.
   */
  source_timeout_ms?: number;
}

export interface PipelineOptsConfig {
  block_concurrency?: number;
}

/**
 * Person communication profile configuration (Spec 8 §9).
 * Disabled by default. allow/deny gate per-person opt-in/out by canonical slug.
 */
export interface ProfileConfig {
  enabled: boolean;
  allow: string[];
  deny: string[];
  min_sample_size: number;
  /** Hours to add to UTC for the active-hours histogram (default 8 for CN workplace). */
  tz_offset_hours: number;
}

/**
 * Retrieval-quality configuration (Spec 10).
 * pool_by_page: best-chunk-per-page pooling for query() (default on).
 * llm_rewrite: optional LLM-based query rewrite before retrieval (default off).
 */
export interface SearchConfig {
  pool_by_page: boolean;
  llm_rewrite: boolean;
}

/**
 * Session distiller configuration (extraction-quality-redesign PR-2, spec §4.3).
 * payload_ttl_days: how long a distilled payload (and its reversible restoration
 * map) is retained after the session reaches `done` before the consolidator
 * sweeps it. Default 90.
 */
export interface DistillerConfig {
  payload_ttl_days: number;
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
  profile: ProfileConfig;
  search: SearchConfig;
  distiller: DistillerConfig;
}

/**
 * Validates StoreConfig at runtime.
 * @param s - The store config section.
 * @param missingEnv - Names of env vars that were NOT resolved (still placeholders).
 * @throws Error if the config is invalid.
 */
export function validateStoreConfig(s: StoreConfig, missingEnv: string[] = []): void {
  const engine = s.engine ?? "pglite";

  if (engine !== "pglite" && engine !== "postgres" && engine !== "managed") {
    throw new Error(
      `Invalid store.engine "${engine}". Supported values: pglite, postgres, managed.`,
    );
  }

  if (engine === "postgres") {
    if (!s.database_url) {
      throw new Error("store.database_url is required when store.engine is postgres.");
    }

    // Check for unresolved env placeholder like ${DATABASE_URL}
    const placeholderMatch = s.database_url.match(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/);
    if (placeholderMatch) {
      const varName = placeholderMatch[1];
      if (missingEnv.includes(varName)) {
        throw new Error(
          `store.database_url contains 未解析的环境变量 (unresolved env var) \${${varName}}. ` +
            `Set the ${varName} environment variable before starting.`,
        );
      }
      // Placeholder is present but env var was resolved — treat as valid
    } else {
      // No placeholder — must be a literal postgres(ql):// URL
      if (!/^postgres(ql)?:\/\//.test(s.database_url)) {
        throw new Error(
          `store.database_url must be a valid postgres(ql):// connection url. ` +
            `Got: "${s.database_url}"`,
        );
      }
    }

    if (s.pool_size !== undefined) {
      if (!Number.isInteger(s.pool_size) || s.pool_size < 1) {
        throw new Error(`store.pool_size must be an integer ≥ 1. Got: ${s.pool_size}`);
      }
    }
  }

  if (engine === "managed" && s.managed !== undefined) {
    const m = s.managed;
    if (m.runtime_dir !== undefined) {
      if (typeof m.runtime_dir !== "string" || m.runtime_dir.trim() === "") {
        throw new Error(
          `store.managed.runtime_dir must be a non-empty string. Got: "${m.runtime_dir}"`,
        );
      }
    }
  }
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
    data_dir: "~/.memkin/data",
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
  profile: {
    enabled: false,
    allow: [],
    deny: [],
    min_sample_size: 20,
    tz_offset_hours: 8,
  },
  search: {
    pool_by_page: true,
    llm_rewrite: false,
  },
  distiller: {
    payload_ttl_days: 90,
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

  const envPath = process.env.MEMKIN_CONFIG;
  if (envPath) return resolve(envPath);

  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, "memkin.yaml");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(process.cwd(), "memkin.yaml");
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
 * @param filePath - Path to YAML config file (default: discovered memkin.yaml)
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

  // Validate store config after env interpolation
  validateStoreConfig((merged as unknown as Config).store ?? {}, interpolated.missing);

  return attachContext(merged as unknown as Config, {
    configPath,
    projectRoot,
    missingEnvVars: interpolated.missing,
  });
}
