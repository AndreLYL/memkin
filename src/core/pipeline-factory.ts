import { createLLMProvider } from "../extractors/providers/index.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import { EntityMergeSuggestionStore } from "../store/entity-suggestions.js";
import type { SqlExecutor } from "../store/sql-executor.js";
import type { Config, LoadedConfig } from "./config.js";
import { IdentityResolver } from "./identity-resolver.js";
import type { PipelineConfig } from "./pipeline.js";
import { statePath } from "./state.js";

export interface PipelineRuntime {
  config: PipelineConfig;
  provider: LLMProvider;
  identity_resolver?: IdentityResolver;
}

function projectRootOf(config: Config, projectRoot?: string): string | undefined {
  return projectRoot ?? (config as Partial<LoadedConfig>).__context?.projectRoot;
}

export function buildPipelineConfig(
  config: Config,
  output_dir: string,
  projectRoot?: string,
): PipelineConfig {
  const stateBase = projectRootOf(config, projectRoot);
  return {
    dedup_checkpoint: statePath("dedup.jsonl", stateBase),
    cursor_checkpoint: statePath("cursors.yaml", stateBase),
    block_gap_minutes: config.block_builder.block_gap_minutes,
    max_block_tokens: config.block_builder.max_block_tokens,
    max_block_messages: config.block_builder.max_block_messages,
    privacy: config.privacy,
    output_dir,
    block_concurrency: config.pipeline?.block_concurrency,
    state_base: stateBase,
  };
}

export async function createPipelineRuntime(
  config: Config,
  pg: SqlExecutor,
  output_dir: string,
): Promise<PipelineRuntime> {
  const llmConfig = { ...config.llm };
  if (!llmConfig.api_key && !process.env.OPENAI_API_KEY) {
    throw new Error("No API key configured. Set api_key in memkin.yaml or OPENAI_API_KEY env var.");
  }
  if (!llmConfig.api_key) {
    llmConfig.api_key = process.env.OPENAI_API_KEY;
  }
  const provider = createLLMProvider(llmConfig);

  const identity_resolver = new IdentityResolver(pg, undefined, new EntityMergeSuggestionStore(pg));

  return {
    config: buildPipelineConfig(config, output_dir),
    provider,
    identity_resolver,
  };
}
