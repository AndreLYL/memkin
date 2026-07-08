import { stringify } from "yaml";
import type { Config } from "../core/config.js";
import type { PartialConfig, PartialSourcesConfig } from "./validate-config.js";

const FEISHU_APP_ID_PLACEHOLDER = "$" + "{FEISHU_APP_ID}";
const FEISHU_APP_SECRET_PLACEHOLDER = "$" + "{FEISHU_APP_SECRET}";

const DEFAULT_PRIVACY: Config["privacy"] = {
  enabled: true,
  mode: "reversible",
  redact_phone: true,
  redact_id_card: true,
  redact_bank_card: true,
  redact_email: false,
  redact_url: false,
  blocked_words: [],
  replacement: "[REDACTED]",
};

const DEFAULT_BLOCK_BUILDER: Config["block_builder"] = {
  block_gap_minutes: 30,
  max_block_tokens: 4000,
  max_block_messages: 100,
};

const DEFAULT_FEISHU: NonNullable<Config["sources"]["feishu"]> = {
  enabled: false,
  app_id: FEISHU_APP_ID_PLACEHOLDER,
  app_secret: FEISHU_APP_SECRET_PLACEHOLDER,
  sources: {
    messages: { enabled: false, chat_ids: [] },
    calendar: { enabled: false, calendar_ids: [] },
    docs: { enabled: false },
    tasks: { enabled: false },
    dm: { enabled: false, dm_chat_ids: [], self_open_id: "" },
  },
};

const DATABASE_URL_PLACEHOLDER = "$" + "{DATABASE_URL}";

function buildStore(store?: Partial<Config["store"]>): Config["store"] {
  const engine = store?.engine ?? "pglite";

  if (engine === "postgres") {
    return {
      engine: "postgres",
      database_url: store?.database_url ?? DATABASE_URL_PLACEHOLDER,
      ...(store?.pool_size !== undefined ? { pool_size: store.pool_size } : {}),
    };
  }

  if (engine === "managed") {
    return {
      engine: "managed",
      ...(store?.managed?.runtime_dir
        ? { managed: { runtime_dir: store.managed.runtime_dir } }
        : {}),
    };
  }

  // pglite (default)
  return {
    engine: "pglite",
    data_dir: store?.data_dir ?? "~/.memkin/data",
  };
}

function buildSources(sources?: PartialSourcesConfig): Config["sources"] {
  const feishu = sources?.feishu;

  return {
    "claude-code": {
      enabled: sources?.["claude-code"]?.enabled ?? true,
      ...(sources?.["claude-code"]?.base_dir ? { base_dir: sources["claude-code"].base_dir } : {}),
    },
    codex: {
      enabled: sources?.codex?.enabled ?? true,
      ...(sources?.codex?.base_dir ? { base_dir: sources.codex.base_dir } : {}),
    },
    hermes: {
      enabled: sources?.hermes?.enabled ?? true,
      ...(sources?.hermes?.base_dir ? { base_dir: sources.hermes.base_dir } : {}),
    },
    feishu: {
      ...DEFAULT_FEISHU,
      ...feishu,
      app_id: feishu?.app_id ?? DEFAULT_FEISHU.app_id,
      app_secret: feishu?.app_secret ?? DEFAULT_FEISHU.app_secret,
      sources: {
        ...DEFAULT_FEISHU.sources,
        ...feishu?.sources,
      },
    },
  };
}

export interface BuildConfigOpts {
  /**
   * Engine to use when no explicit store.engine is set in config.
   * Only passed on a genuine new-install path — never on config regeneration.
   * When absent the silent default (pglite) is used, preserving existing behaviour.
   */
  newInstallEngine?: "managed" | "pglite";
}

export function buildConfigObject(config: PartialConfig, opts?: BuildConfigOpts): Config {
  const embeddingProvider = config.embedding?.provider ?? "openai";
  const embeddingModel =
    config.embedding?.model ??
    (embeddingProvider === "ollama" ? "nomic-embed-text" : "text-embedding-3-large");
  const embeddingDimensions =
    config.embedding?.dimensions ?? (embeddingProvider === "ollama" ? 768 : 1536);

  // Resolve which store config to pass to buildStore:
  // - If config.store?.engine is explicitly set, honour it (always wins).
  // - Otherwise, if a newInstallEngine opt is given, inject it as the engine default.
  // - If neither, buildStore's own default (pglite) is used — unchanged behaviour.
  let storeConfig = config.store;
  if (!config.store?.engine && opts?.newInstallEngine) {
    storeConfig = { ...config.store, engine: opts.newInstallEngine };
  }

  return {
    privacy: {
      ...DEFAULT_PRIVACY,
      ...config.privacy,
    },
    llm: {
      provider: config.llm?.provider ?? "openai",
      model: config.llm?.model ?? "gpt-4o-mini",
      ...(config.llm?.base_url ? { base_url: config.llm.base_url } : {}),
      ...(config.llm?.api_key ? { api_key: config.llm.api_key } : {}),
      ...(config.llm?.filter_model ? { filter_model: config.llm.filter_model } : {}),
      ...(config.llm?.filter_provider ? { filter_provider: config.llm.filter_provider } : {}),
    },
    block_builder: {
      ...DEFAULT_BLOCK_BUILDER,
      ...config.block_builder,
    },
    adapters: {},
    sources: buildSources(config.sources),
    store: buildStore(storeConfig),
    embedding: {
      provider: embeddingProvider,
      model: embeddingModel,
      dimensions: embeddingDimensions,
      ...(config.embedding?.api_key ? { api_key: config.embedding.api_key } : {}),
      ...(config.embedding?.base_url ? { base_url: config.embedding.base_url } : {}),
    },
    server: {
      http_port: config.server?.http_port ?? 3927,
      mcp_transport: config.server?.mcp_transport ?? "stdio",
    },
    // Pass scheduler through unchanged when present. AutoFetchSection saves
    // {enabled, tick_interval_secs, defaults, sources} as a complete block;
    // dropping it here is why the Auto-fetch toggle reset on every reload.
    ...(config.scheduler ? { scheduler: config.scheduler } : {}),
    mcp: {
      expose_legacy_tools: config.mcp?.expose_legacy_tools ?? false,
      http: {
        enabled: config.mcp?.http?.enabled ?? false,
        bind_host: config.mcp?.http?.bind_host ?? "127.0.0.1",
        port: config.mcp?.http?.port ?? 3928,
        allowed_origins: config.mcp?.http?.allowed_origins ?? [
          "http://127.0.0.1:3928",
          "http://localhost:3928",
        ],
        allowed_hosts: config.mcp?.http?.allowed_hosts ?? ["127.0.0.1:3928", "localhost:3928"],
        auth_token_env: config.mcp?.http?.auth_token_env ?? "",
        read_only: config.mcp?.http?.read_only ?? true,
      },
    },
    profile: {
      enabled: config.profile?.enabled ?? false,
      allow: config.profile?.allow ?? [],
      deny: config.profile?.deny ?? [],
      min_sample_size: config.profile?.min_sample_size ?? 20,
      tz_offset_hours: config.profile?.tz_offset_hours ?? 8,
    },
    search: {
      pool_by_page: config.search?.pool_by_page ?? true,
      llm_rewrite: config.search?.llm_rewrite ?? false,
    },
    distiller: {
      payload_ttl_days: config.distiller?.payload_ttl_days ?? 90,
    },
  };
}

export function generateConfigYaml(config: PartialConfig, opts?: BuildConfigOpts): string {
  const header = "# Memkin Configuration\n# Generated by 'memkin init'\n\n";
  return `${header}${stringify(buildConfigObject(config, opts), { indent: 2 })}`;
}
