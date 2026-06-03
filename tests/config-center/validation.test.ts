import { describe, expect, it } from "vitest";
import { validateDraft } from "../../src/config-center/validation.js";

describe("config-center validation", () => {
  it("returns field-level diagnostics for missing required LLM values", () => {
    const diagnostics = validateDraft({
      llm: { provider: "", model: "" },
      sources: { "claude-code": { enabled: true } },
    });

    expect(diagnostics).toContainEqual({
      path: "llm.provider",
      severity: "error",
      message: "LLM provider is required",
    });
    expect(diagnostics).toContainEqual({
      path: "llm.model",
      severity: "error",
      message: "LLM model is required",
    });
  });

  it("requires at least one enabled source", () => {
    const diagnostics = validateDraft({
      llm: { provider: "mock", model: "mock-model" },
      sources: {
        "claude-code": { enabled: false },
        codex: { enabled: false },
        hermes: { enabled: false },
        feishu: { enabled: false },
      },
    });

    expect(diagnostics).toContainEqual({
      path: "sources",
      severity: "error",
      message: "At least one data source must be enabled",
    });
  });

  it("warns for missing agent source directories but does not block saving", () => {
    const diagnostics = validateDraft({
      llm: { provider: "mock", model: "mock-model" },
      sources: {
        "claude-code": { enabled: true, base_dir: "/path/that/does/not/exist" },
      },
    });

    expect(diagnostics).toContainEqual({
      path: "sources.claude-code.base_dir",
      severity: "warning",
      message: "Source directory does not exist",
    });
  });

  it("validates numeric ranges", () => {
    const diagnostics = validateDraft({
      llm: { provider: "mock", model: "mock-model" },
      sources: { "claude-code": { enabled: true } },
      block_builder: {
        block_gap_minutes: 0,
        max_block_tokens: 50,
        max_block_messages: 0,
      },
      server: { http_port: 70000 },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toContain(
      "block_builder.block_gap_minutes",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toContain(
      "block_builder.max_block_tokens",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toContain(
      "block_builder.max_block_messages",
    );
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toContain("server.http_port");
  });
});
