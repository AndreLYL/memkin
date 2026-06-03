import type { AssessmentResult } from "../setup/assess-hardware.js";
import type { DetectedApiKeys } from "../setup/detect-api-keys.js";

export type RecommendationSource = "api-key" | "data-volume" | "default" | "hardware";

export interface FieldRecommendation {
  path: string;
  value: string;
  reason: string;
  source: RecommendationSource;
}

export interface RecommendationContext {
  apiKeys?: Pick<DetectedApiKeys, "anthropic" | "openai" | "source">;
  embeddingAssessment?: Pick<AssessmentResult, "reason" | "recommendation">;
}

function recommendLLMProvider(apiKeys: RecommendationContext["apiKeys"]): FieldRecommendation {
  if (apiKeys?.openai) {
    return {
      path: "llm.provider",
      value: "openai",
      reason: `OPENAI_API_KEY detected from ${apiKeys.source}; OpenAI is the simplest first-run provider.`,
      source: "api-key",
    };
  }

  if (apiKeys?.anthropic) {
    return {
      path: "llm.provider",
      value: "anthropic",
      reason: `ANTHROPIC_API_KEY detected from ${apiKeys.source}; Anthropic can be used without another key.`,
      source: "api-key",
    };
  }

  return {
    path: "llm.provider",
    value: "openai",
    reason: "No provider API key detected; OpenAI remains the product default.",
    source: "default",
  };
}

function recommendEmbeddingProvider(
  assessment: RecommendationContext["embeddingAssessment"],
): FieldRecommendation {
  if (assessment) {
    return {
      path: "embedding.provider",
      value: assessment.recommendation,
      reason: assessment.reason,
      source: "hardware",
    };
  }

  return {
    path: "embedding.provider",
    value: "openai",
    reason: "Hardware and data volume were not assessed; OpenAI remains the product default.",
    source: "default",
  };
}

export function buildConfigRecommendations(
  context: RecommendationContext = {},
): FieldRecommendation[] {
  return [
    recommendLLMProvider(context.apiKeys),
    recommendEmbeddingProvider(context.embeddingAssessment),
  ];
}

export function findRecommendation(
  recommendations: FieldRecommendation[],
  path: string,
): FieldRecommendation | undefined {
  return recommendations.find((recommendation) => recommendation.path === path);
}
