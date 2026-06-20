import type { Config } from "../core/config.js";

/**
 * Stable signature over the Tier-2-relevant config subset.
 * Same signature → scheduling-only change → Tier 1 reconcile.
 * Different signature → credential/pipeline change → Tier 2 rebuild.
 * Deliberately EXCLUDES the scheduler section (Tier 1's domain).
 */
export function runtimeSignature(config: Config): string {
  const subset = {
    llm: config.llm,
    embedding: config.embedding,
    privacy: config.privacy,
    block_builder: config.block_builder,
    pipeline: config.pipeline ?? null,
    sources: config.sources,
  };
  return JSON.stringify(subset);
}
