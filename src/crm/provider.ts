import type { LLMConfig } from "../core/config.js";
import { createLLMProvider } from "../extractors/providers/index.js";
import type { CrmProvider } from "./extract.js";

/** Resolve lazily, including after a config reload. Missing models never imply a fake extraction. */
export function configuredCrmProvider(getConfig: () => LLMConfig): CrmProvider {
  return () => {
    const config = { ...getConfig() };
    if (config.provider === "mock") return undefined;
    config.api_key ||=
      config.provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    return config.api_key ? createLLMProvider(config) : undefined;
  };
}
