import type { LoadedConfig } from "./config.js";

export type EnvValidationCommand = "extract" | "embed" | "search" | "serve" | "doctor";

const ENV_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function placeholdersIn(value: unknown): string[] {
  const result = new Set<string>();

  function walk(item: unknown): void {
    if (typeof item === "string") {
      for (const match of item.matchAll(ENV_REF_PATTERN)) {
        result.add(match[1]);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) walk(child);
      return;
    }
    if (item !== null && typeof item === "object") {
      for (const child of Object.values(item)) walk(child);
    }
  }

  walk(value);
  return Array.from(result).sort();
}

function hasUsableSecret(value: string | undefined): boolean {
  return Boolean(value && !value.match(ENV_REF_PATTERN));
}

function llmEnvVar(provider: string): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

function missingLlmVars(config: LoadedConfig): string[] {
  const missing = new Set<string>();
  const providerEnv = llmEnvVar(config.llm.provider);

  for (const name of placeholdersIn(config.llm)) {
    if (config.__context.missingEnvVars.includes(name)) missing.add(name);
  }

  if (!hasUsableSecret(config.llm.api_key) && !process.env[providerEnv]) {
    missing.add(providerEnv);
  }

  return Array.from(missing).sort();
}

function missingEmbeddingVars(config: LoadedConfig): string[] {
  if (config.embedding.provider !== "openai") return [];

  const missing = new Set<string>();
  for (const name of placeholdersIn(config.embedding)) {
    if (config.__context.missingEnvVars.includes(name)) missing.add(name);
  }

  if (!hasUsableSecret(config.embedding.api_key) && !process.env.OPENAI_API_KEY) {
    missing.add("OPENAI_API_KEY");
  }

  return Array.from(missing).sort();
}

export function getMissingEnvVarsForCommand(
  config: LoadedConfig,
  command: EnvValidationCommand,
  opts: { searchMode?: string } = {},
): string[] {
  const missing = new Set<string>();

  if (command === "extract") {
    for (const name of missingLlmVars(config)) missing.add(name);
  } else if (command === "embed") {
    for (const name of missingEmbeddingVars(config)) missing.add(name);
  } else if (command === "search") {
    if (opts.searchMode !== "fts") {
      for (const name of missingEmbeddingVars(config)) missing.add(name);
    }
  } else if (command === "doctor") {
    for (const name of config.__context.missingEnvVars) missing.add(name);
    for (const name of missingLlmVars(config)) missing.add(name);
    for (const name of missingEmbeddingVars(config)) missing.add(name);
  } else if (command === "serve") {
    for (const name of config.__context.missingEnvVars) missing.add(name);
  }

  return Array.from(missing).sort();
}

export function validateEnvForCommand(
  config: LoadedConfig,
  command: Exclude<EnvValidationCommand, "doctor" | "serve">,
  opts: { searchMode?: string } = {},
): void {
  const missing = getMissingEnvVarsForCommand(config, command, opts);
  if (missing.length === 0) return;

  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}\n` +
      `Referenced by: ${config.__context.configPath}\n` +
      "Set them in your shell or replace the $" +
      "{VAR} placeholders in memkin.yaml.",
  );
}
