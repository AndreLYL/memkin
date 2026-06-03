import { describe, expect, it } from "vitest";
import { validateConfig } from "../../src/setup/validate-config.js";

describe("validate setup config", () => {
  it("passes validation for a minimal valid config", () => {
    expect(
      validateConfig({
        llm: { provider: "openai", model: "gpt-4o-mini" },
        sources: { "claude-code": { enabled: true } },
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("requires LLM provider and model", () => {
    const result = validateConfig({
      llm: {},
      sources: { "claude-code": { enabled: true } },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("LLM provider is required");
    expect(result.errors).toContain("LLM model is required");
  });

  it("requires at least one enabled data source", () => {
    const result = validateConfig({
      llm: { provider: "openai", model: "gpt-4o-mini" },
      sources: {
        "claude-code": { enabled: false },
        codex: { enabled: false },
        hermes: { enabled: false },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one data source must be enabled");
  });

  it("requires Feishu credentials when Feishu is enabled", () => {
    const result = validateConfig({
      llm: { provider: "openai", model: "gpt-4o-mini" },
      sources: {
        feishu: {
          enabled: true,
          app_id: "",
          app_secret: "",
        },
      },
    });

    expect(result.errors).toContain("Feishu App ID is required when Feishu is enabled");
    expect(result.errors).toContain("Feishu App Secret is required when Feishu is enabled");
  });
});
