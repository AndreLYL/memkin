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

  it("requires Feishu app credentials when a bot-scoped source is enabled", () => {
    // Since #117 credentials are only required for bot-scoped sources
    // (messages/calendar/tasks/dm); user-scoped sources authorize via lark-cli.
    const result = validateConfig({
      llm: { provider: "openai", model: "gpt-4o-mini" },
      sources: {
        feishu: {
          enabled: true,
          app_id: "",
          app_secret: "",
          sources: { messages: { enabled: true } },
        },
      },
    });

    expect(result.errors).toContain(
      "Feishu App ID is required for bot-scoped sources (messages, calendar, tasks, dm)",
    );
    expect(result.errors).toContain(
      "Feishu App Secret is required for bot-scoped sources (messages, calendar, tasks, dm)",
    );
  });

  it("allows user-only Feishu (no bot-scoped sources) without app credentials", () => {
    const result = validateConfig({
      llm: { provider: "openai", model: "gpt-4o-mini" },
      sources: {
        feishu: {
          enabled: true,
          app_id: "",
          app_secret: "",
          sources: { mail: { enabled: true } },
        },
      },
    });

    expect(result.errors).not.toContain(
      "Feishu App ID is required for bot-scoped sources (messages, calendar, tasks, dm)",
    );
  });

  it("requires explicit security settings for public MCP HTTP exposure", () => {
    const result = validateConfig({
      llm: { provider: "openai", model: "gpt-4o-mini" },
      sources: { "claude-code": { enabled: true } },
      mcp: {
        expose_legacy_tools: false,
        http: {
          enabled: true,
          bind_host: "0.0.0.0",
          port: 3928,
          allowed_origins: [],
          allowed_hosts: [],
          auth_token_env: "",
          read_only: false,
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "MCP HTTP allowed_origins must contain at least one trusted origin",
    );
    expect(result.errors).toContain(
      "MCP HTTP allowed_hosts must contain at least one trusted host",
    );
    expect(result.errors).toContain("MCP HTTP public bind requires auth_token_env");
  });
});
