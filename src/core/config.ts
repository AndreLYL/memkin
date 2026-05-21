/**
 * Configuration loader for DigitalBrainExtractor
 * Loads YAML config files with environment variable interpolation
 * and recursive merging with defaults
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';

/**
 * Privacy configuration interface
 */
export interface PrivacyConfig {
  enabled: boolean;
  mode: 'reversible' | 'irreversible';
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
export interface SourcesConfig {
  'claude-code'?: SourceConfig;
  codex?: SourceConfig;
  hermes?: SourceConfig;
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
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
  privacy: {
    enabled: true,
    mode: 'reversible',
    redact_phone: true,
    redact_id_card: true,
    redact_bank_card: true,
    redact_email: false,
    redact_url: false,
    blocked_words: [],
    replacement: '[REDACTED]',
  },
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
  },
  block_builder: {
    block_gap_minutes: 30,
    max_block_tokens: 4000,
    max_block_messages: 100,
  },
  adapters: {},
  sources: {
    'claude-code': { enabled: true },
    codex: { enabled: true },
    hermes: { enabled: true },
  },
};

/**
 * Recursively interpolate environment variables in an object
 * Replaces ${VAR_NAME} with process.env.VAR_NAME
 * If VAR_NAME is not found, replaces with empty string
 *
 * @param obj - Object to interpolate
 * @returns Object with interpolated values
 */
function interpolateEnv(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Replace ${VAR_NAME} with process.env.VAR_NAME
    return obj.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, varName) => {
      return process.env[varName] ?? '';
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateEnv(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnv(value);
    }
    return result;
  }

  return obj;
}

/**
 * Deep merge user config into defaults
 * User values override defaults at all levels
 *
 * @param defaults - Default configuration
 * @param user - User-provided configuration
 * @returns Merged configuration
 */
function mergeConfig(defaults: Record<string, any>, user: Record<string, any>): Record<string, any> {
  const result = { ...defaults };

  for (const key in user) {
    const userValue = user[key];
    const defaultValue = defaults[key];

    // If user value is an object and default exists and is an object, merge recursively
    if (
      userValue !== null &&
      typeof userValue === 'object' &&
      !Array.isArray(userValue) &&
      defaultValue !== null &&
      typeof defaultValue === 'object' &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = mergeConfig(defaultValue, userValue);
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
 * @param filePath - Path to YAML config file (default: dbe.yaml in cwd)
 * @returns Loaded and merged configuration
 * @throws Error if file cannot be read or parsed
 */
export function loadConfig(filePath?: string): Config {
  const configPath = filePath ? resolve(filePath) : resolve(process.cwd(), 'dbe.yaml');

  let userConfig: Record<string, any> = {};

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parse(content);
    userConfig = parsed || {};
  } catch (error) {
    // If file doesn't exist or can't be read, use empty config (will use defaults)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // Interpolate environment variables
  userConfig = interpolateEnv(userConfig) as Record<string, any>;

  // Merge with defaults
  const merged = mergeConfig(DEFAULT_CONFIG as unknown as Record<string, any>, userConfig);

  return merged as Config;
}
