import { describe, expect, it } from "vitest";
import {
  buildConfigRecommendations,
  findRecommendation,
} from "../../src/config-center/recommendations.js";

describe("config-center recommendations", () => {
  it("recommends OpenAI for LLM when an OpenAI key is detected", () => {
    const recommendations = buildConfigRecommendations({
      apiKeys: { openai: "sk-openai", source: "environment" },
    });

    const llm = findRecommendation(recommendations, "llm.provider");

    expect(llm).toMatchObject({
      path: "llm.provider",
      value: "openai",
      source: "api-key",
    });
    expect(llm?.reason).toContain("OPENAI_API_KEY");
  });

  it("recommends Anthropic for LLM when only an Anthropic key is detected", () => {
    const recommendations = buildConfigRecommendations({
      apiKeys: { anthropic: "sk-ant", source: ".zshrc" },
    });

    expect(findRecommendation(recommendations, "llm.provider")).toMatchObject({
      path: "llm.provider",
      value: "anthropic",
      source: "api-key",
    });
  });

  it("keeps OpenAI as the default LLM recommendation when no key is detected", () => {
    const recommendations = buildConfigRecommendations({
      apiKeys: { source: "none" },
    });

    expect(findRecommendation(recommendations, "llm.provider")).toMatchObject({
      path: "llm.provider",
      value: "openai",
      source: "default",
    });
  });

  it("uses embedding assessment as the embedding provider recommendation", () => {
    const recommendations = buildConfigRecommendations({
      embeddingAssessment: {
        recommendation: "ollama",
        reason: "Apple Silicon detected; local embeddings are suitable.",
      },
    });

    expect(findRecommendation(recommendations, "embedding.provider")).toMatchObject({
      path: "embedding.provider",
      value: "ollama",
      reason: "Apple Silicon detected; local embeddings are suitable.",
      source: "hardware",
    });
  });
});
