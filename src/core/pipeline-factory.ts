import type { PGlite } from "@electric-sql/pglite";
import { FeishuCollector, getCollector } from "../collectors/index.js";
import { createLLMProvider } from "../extractors/providers/index.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { Config } from "./config.js";
import { IdentityResolver } from "./identity-resolver.js";
import type { PipelineConfig } from "./pipeline.js";
import { statePath } from "./state.js";

export interface PipelineRuntime {
  config: PipelineConfig;
  provider: LLMProvider;
  identity_resolver?: IdentityResolver;
}

export function buildPipelineConfig(config: Config, output_dir: string): PipelineConfig {
  return {
    dedup_checkpoint: statePath("dedup.jsonl"),
    cursor_checkpoint: statePath("cursors.yaml"),
    block_gap_minutes: config.block_builder.block_gap_minutes,
    max_block_tokens: config.block_builder.max_block_tokens,
    max_block_messages: config.block_builder.max_block_messages,
    privacy: config.privacy,
    output_dir,
  };
}

export async function createPipelineRuntime(
  config: Config,
  pg: PGlite,
  output_dir: string,
): Promise<PipelineRuntime> {
  const llmConfig = { ...config.llm };
  if (!llmConfig.api_key && !process.env.OPENAI_API_KEY) {
    throw new Error(
      "No API key configured. Set api_key in memoark.yaml or OPENAI_API_KEY env var.",
    );
  }
  if (!llmConfig.api_key) {
    llmConfig.api_key = process.env.OPENAI_API_KEY;
  }
  const provider = createLLMProvider(llmConfig);

  let identity_resolver: IdentityResolver | undefined;
  const feishuCollector = getCollector("feishu");
  if (feishuCollector instanceof FeishuCollector) {
    identity_resolver = new IdentityResolver(pg, feishuCollector.getIdentityBackend());
  } else {
    identity_resolver = new IdentityResolver(pg);
  }

  return {
    config: buildPipelineConfig(config, output_dir),
    provider,
    identity_resolver,
  };
}
