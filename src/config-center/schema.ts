export type ConfigSectionPhase = "mvp" | "phase6";

export interface ConfigSection {
  id: string;
  label: string;
  phase: ConfigSectionPhase;
}

export type ConfigFieldKind =
  | "boolean"
  | "enum"
  | "number"
  | "path"
  | "secret"
  | "string"
  | "string-list";

export interface ConfigField {
  path: string;
  section: string;
  label: string;
  description: string;
  kind: ConfigFieldKind;
  secret?: boolean;
  advanced?: boolean;
  required?: boolean;
  phase: ConfigSectionPhase;
  options?: Array<{ value: string; label: string }>;
  appliesWhen?: { path: string; values: string[] };
}

type ConfigFieldDefinition = Omit<ConfigField, "description">;

export const CONFIG_SECTIONS: ConfigSection[] = [
  { id: "overview", label: "Overview", phase: "mvp" },
  { id: "llm", label: "LLM", phase: "mvp" },
  { id: "embedding", label: "Embedding", phase: "mvp" },
  { id: "sources", label: "Sources", phase: "mvp" },
  { id: "feishu", label: "Feishu", phase: "phase6" },
  { id: "privacy", label: "Privacy", phase: "mvp" },
  { id: "block_builder", label: "Block Builder", phase: "mvp" },
  { id: "store", label: "Store", phase: "phase6" },
  { id: "server", label: "Server", phase: "phase6" },
  { id: "mcp", label: "MCP", phase: "phase6" },
  { id: "adapters", label: "Adapters", phase: "phase6" },
  { id: "preview", label: "Preview & Save", phase: "mvp" },
];

const RAW_CONFIG_FIELDS: ConfigFieldDefinition[] = [
  {
    path: "llm.provider",
    section: "llm",
    label: "Provider",
    kind: "enum",
    phase: "mvp",
    required: true,
    options: [
      { value: "openai", label: "OpenAI" },
      { value: "anthropic", label: "Anthropic" },
      { value: "mock", label: "Mock" },
    ],
  },
  {
    path: "llm.model",
    section: "llm",
    label: "Model",
    kind: "string",
    phase: "mvp",
    required: true,
  },
  {
    path: "llm.base_url",
    section: "llm",
    label: "Base URL",
    kind: "string",
    phase: "mvp",
    required: true,
  },
  {
    path: "llm.api_key",
    section: "llm",
    label: "API Key",
    kind: "secret",
    secret: true,
    phase: "mvp",
    required: true,
  },
  {
    path: "llm.filter_provider",
    section: "llm",
    label: "Filter Provider",
    kind: "string",
    advanced: true,
    phase: "mvp",
  },
  {
    path: "llm.filter_model",
    section: "llm",
    label: "Filter Model",
    kind: "string",
    advanced: true,
    phase: "mvp",
  },
  {
    path: "embedding.provider",
    section: "embedding",
    label: "Provider",
    kind: "enum",
    phase: "mvp",
    required: true,
    options: [
      { value: "openai", label: "OpenAI" },
      { value: "ollama", label: "Ollama" },
    ],
  },
  {
    path: "embedding.model",
    section: "embedding",
    label: "Model",
    kind: "string",
    phase: "mvp",
    required: true,
  },
  {
    path: "embedding.dimensions",
    section: "embedding",
    label: "Dimensions",
    kind: "number",
    phase: "mvp",
    required: true,
  },
  {
    path: "embedding.api_key",
    section: "embedding",
    label: "API Key",
    kind: "secret",
    secret: true,
    phase: "mvp",
    required: true,
    appliesWhen: { path: "embedding.provider", values: ["openai"] },
  },
  {
    path: "embedding.base_url",
    section: "embedding",
    label: "Base URL",
    kind: "string",
    phase: "mvp",
    required: true,
  },
  {
    path: "sources.claude-code.enabled",
    section: "sources",
    label: "Claude Code Enabled",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "sources.claude-code.base_dir",
    section: "sources",
    label: "Claude Code Base Dir",
    kind: "path",
    phase: "mvp",
  },
  {
    path: "sources.codex.enabled",
    section: "sources",
    label: "Codex Enabled",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "sources.codex.base_dir",
    section: "sources",
    label: "Codex Base Dir",
    kind: "path",
    phase: "mvp",
  },
  {
    path: "sources.hermes.enabled",
    section: "sources",
    label: "Hermes Enabled",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "sources.hermes.base_dir",
    section: "sources",
    label: "Hermes Base Dir",
    kind: "path",
    phase: "mvp",
  },
  {
    path: "sources.feishu.enabled",
    section: "feishu",
    label: "Enabled",
    kind: "boolean",
    phase: "phase6",
  },
  {
    path: "sources.feishu.app_id",
    section: "feishu",
    label: "App ID",
    kind: "secret",
    secret: true,
    phase: "phase6",
  },
  {
    path: "sources.feishu.app_secret",
    section: "feishu",
    label: "App Secret",
    kind: "secret",
    secret: true,
    phase: "phase6",
  },
  { path: "privacy.enabled", section: "privacy", label: "Enabled", kind: "boolean", phase: "mvp" },
  { path: "privacy.mode", section: "privacy", label: "Mode", kind: "enum", phase: "mvp" },
  {
    path: "privacy.redact_phone",
    section: "privacy",
    label: "Redact Phone",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "privacy.redact_id_card",
    section: "privacy",
    label: "Redact ID Cards",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "privacy.redact_bank_card",
    section: "privacy",
    label: "Redact Bank Cards",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "privacy.redact_email",
    section: "privacy",
    label: "Redact Email",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "privacy.redact_url",
    section: "privacy",
    label: "Redact URLs",
    kind: "boolean",
    phase: "mvp",
  },
  {
    path: "privacy.blocked_words",
    section: "privacy",
    label: "Blocked Words",
    kind: "string-list",
    phase: "mvp",
  },
  {
    path: "privacy.replacement",
    section: "privacy",
    label: "Replacement",
    kind: "string",
    phase: "mvp",
  },
  {
    path: "block_builder.block_gap_minutes",
    section: "block_builder",
    label: "Block Gap Minutes",
    kind: "number",
    phase: "mvp",
  },
  {
    path: "block_builder.max_block_tokens",
    section: "block_builder",
    label: "Max Block Tokens",
    kind: "number",
    phase: "mvp",
  },
  {
    path: "block_builder.max_block_messages",
    section: "block_builder",
    label: "Max Block Messages",
    kind: "number",
    phase: "mvp",
  },
  { path: "store.data_dir", section: "store", label: "Data Dir", kind: "path", phase: "phase6" },
  {
    path: "server.http_port",
    section: "server",
    label: "HTTP Port",
    kind: "number",
    phase: "phase6",
  },
  {
    path: "server.mcp_transport",
    section: "server",
    label: "MCP Transport",
    kind: "enum",
    phase: "phase6",
    options: [
      { value: "stdio", label: "stdio" },
      { value: "sse", label: "sse" },
      { value: "streamable_http", label: "Streamable HTTP" },
    ],
  },
  {
    path: "mcp.expose_legacy_tools",
    section: "mcp",
    label: "Expose Legacy Tools",
    kind: "boolean",
    phase: "phase6",
  },
  {
    path: "mcp.http.enabled",
    section: "mcp",
    label: "HTTP Enabled",
    kind: "boolean",
    phase: "phase6",
  },
  {
    path: "mcp.http.bind_host",
    section: "mcp",
    label: "HTTP Bind Host",
    kind: "string",
    phase: "phase6",
    appliesWhen: { path: "mcp.http.enabled", values: ["true"] },
  },
  {
    path: "mcp.http.port",
    section: "mcp",
    label: "HTTP Port",
    kind: "number",
    phase: "phase6",
    appliesWhen: { path: "mcp.http.enabled", values: ["true"] },
  },
  {
    path: "mcp.http.allowed_origins",
    section: "mcp",
    label: "Allowed Origins",
    kind: "string-list",
    phase: "phase6",
    appliesWhen: { path: "mcp.http.enabled", values: ["true"] },
  },
  {
    path: "mcp.http.allowed_hosts",
    section: "mcp",
    label: "Allowed Hosts",
    kind: "string-list",
    phase: "phase6",
    appliesWhen: { path: "mcp.http.enabled", values: ["true"] },
  },
  {
    path: "mcp.http.auth_token_env",
    section: "mcp",
    label: "Auth Token Env",
    kind: "secret",
    secret: true,
    phase: "phase6",
    appliesWhen: { path: "mcp.http.enabled", values: ["true"] },
  },
  {
    path: "mcp.http.read_only",
    section: "mcp",
    label: "Read Only",
    kind: "boolean",
    phase: "phase6",
    appliesWhen: { path: "mcp.http.enabled", values: ["true"] },
  },
  {
    path: "adapters.file.enabled",
    section: "adapters",
    label: "File Enabled",
    kind: "boolean",
    phase: "phase6",
  },
  {
    path: "adapters.file.output_dir",
    section: "adapters",
    label: "File Output Dir",
    kind: "path",
    phase: "phase6",
  },
  {
    path: "adapters.gbrain.enabled",
    section: "adapters",
    label: "GBrain Enabled",
    kind: "boolean",
    phase: "phase6",
  },
  {
    path: "adapters.gbrain.output_dir",
    section: "adapters",
    label: "GBrain Output Dir",
    kind: "path",
    phase: "phase6",
  },
];

const FIELD_DESCRIPTIONS: Record<string, string> = {
  "llm.provider": "Selects the LLM provider used for signal extraction.",
  "llm.model": "Model name passed to the configured LLM provider.",
  "llm.base_url": "Optional endpoint for OpenAI-compatible or proxy providers.",
  "llm.api_key": "Secret used to authenticate LLM requests; env placeholders are supported.",
  "llm.filter_provider": "Optional provider override for the secondary noise filter model.",
  "llm.filter_model": "Optional lightweight model used by L2 noise filtering.",
  "embedding.provider": "Selects the embedding backend for semantic search vectors.",
  "embedding.model": "Embedding model used to vectorize chunks and search queries.",
  "embedding.dimensions": "Vector dimension expected from the selected embedding model.",
  "embedding.api_key": "Secret used for remote embedding providers; leave empty for Ollama.",
  "embedding.base_url": "Endpoint for the embedding provider, such as an Ollama server.",
  "sources.claude-code.enabled": "Enables collection from local Claude Code session files.",
  "sources.claude-code.base_dir": "Overrides the default Claude Code projects directory.",
  "sources.codex.enabled": "Enables collection from local Codex session files.",
  "sources.codex.base_dir": "Overrides the default Codex data directory.",
  "sources.hermes.enabled": "Enables collection from local Hermes agent session files.",
  "sources.hermes.base_dir": "Overrides the default Hermes agents directory.",
  "sources.feishu.enabled": "Enables Feishu collection when Feishu credentials are configured.",
  "sources.feishu.app_id": "Feishu application ID used to request tenant access tokens.",
  "sources.feishu.app_secret": "Feishu application secret used to request tenant access tokens.",
  "privacy.enabled": "Turns privacy redaction on before extracted content is stored.",
  "privacy.mode": "Controls whether redaction is reversible or permanently masked.",
  "privacy.redact_phone": "Masks phone numbers detected in collected content.",
  "privacy.redact_id_card": "Masks ID card numbers detected in collected content.",
  "privacy.redact_bank_card": "Masks bank card numbers detected in collected content.",
  "privacy.redact_email": "Masks email addresses detected in collected content.",
  "privacy.redact_url": "Masks URLs detected in collected content.",
  "privacy.blocked_words": "Comma-separated custom words or phrases to redact.",
  "privacy.replacement": "Text inserted when a value is redacted.",
  "block_builder.block_gap_minutes": "Maximum time gap before messages start a new block.",
  "block_builder.max_block_tokens": "Maximum approximate token size for one conversation block.",
  "block_builder.max_block_messages": "Maximum number of messages allowed in one block.",
  "store.data_dir": "Directory where Memkin stores its embedded database files.",
  "server.http_port": "Port used by the HTTP API server.",
  "server.mcp_transport": "Transport mode used when serving Memkin over MCP.",
  "mcp.expose_legacy_tools":
    "Exposes legacy/debug MCP tools in addition to the preferred tool surface.",
  "mcp.http.enabled":
    "Enables MCP Streamable HTTP transport; stdio remains the recommended local default.",
  "mcp.http.bind_host": "Host address for MCP Streamable HTTP, usually 127.0.0.1.",
  "mcp.http.port": "Port used by MCP Streamable HTTP.",
  "mcp.http.allowed_origins": "Trusted browser/client origins allowed to call MCP HTTP.",
  "mcp.http.allowed_hosts": "Trusted Host header values allowed for MCP HTTP.",
  "mcp.http.auth_token_env": "Environment variable containing the bearer token for MCP HTTP.",
  "mcp.http.read_only": "Hides write tools when serving MCP over HTTP.",
  "adapters.file.enabled": "Enables writing extraction output to local files.",
  "adapters.file.output_dir": "Directory for file adapter output.",
  "adapters.gbrain.enabled": "Enables writing extraction output to the GBrain adapter.",
  "adapters.gbrain.output_dir": "Directory for GBrain adapter output.",
};

function attachFieldDescriptions(fields: ConfigFieldDefinition[]): ConfigField[] {
  return fields.map((field) => {
    const description = FIELD_DESCRIPTIONS[field.path];
    if (!description) {
      throw new Error(`Missing config field description: ${field.path}`);
    }
    return { ...field, description };
  });
}

export const CONFIG_FIELDS: ConfigField[] = attachFieldDescriptions(RAW_CONFIG_FIELDS);

function getPathValue(source: unknown, path: string): unknown {
  let cursor = source;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export function fieldAppliesToDraft(field: ConfigField, draft: unknown): boolean {
  if (!field.appliesWhen) return true;
  const value = getPathValue(draft, field.appliesWhen.path);
  return field.appliesWhen.values.includes(String(value));
}

export function getConfigFieldsForSection(sectionId: string, draft: unknown): ConfigField[] {
  return CONFIG_FIELDS.filter(
    (field) => field.section === sectionId && fieldAppliesToDraft(field, draft),
  );
}
