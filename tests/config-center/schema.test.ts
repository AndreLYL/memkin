import { describe, expect, it } from "vitest";
import {
  CONFIG_FIELDS,
  CONFIG_SECTIONS,
  getConfigFieldsForSection,
} from "../../src/config-center/schema.js";

describe("config-center schema", () => {
  it("has unique field paths", () => {
    const paths = CONFIG_FIELDS.map((field) => field.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("marks MVP and Phase 6 fields explicitly", () => {
    expect(CONFIG_SECTIONS.find((section) => section.id === "llm")?.phase).toBe("mvp");
    expect(CONFIG_SECTIONS.find((section) => section.id === "embedding")?.phase).toBe("mvp");
    expect(CONFIG_SECTIONS.find((section) => section.id === "sources")?.phase).toBe("mvp");
    expect(CONFIG_SECTIONS.find((section) => section.id === "feishu")?.phase).toBe("phase6");
    expect(CONFIG_SECTIONS.find((section) => section.id === "server")?.phase).toBe("phase6");
    expect(CONFIG_SECTIONS.find((section) => section.id === "mcp")?.phase).toBe("phase6");
    expect(CONFIG_SECTIONS.find((section) => section.id === "adapters")?.phase).toBe("phase6");
  });

  it("marks secret fields", () => {
    const secretPaths = CONFIG_FIELDS.filter((field) => field.secret).map((field) => field.path);

    expect(secretPaths).toContain("llm.api_key");
    expect(secretPaths).toContain("embedding.api_key");
    expect(secretPaths).toContain("sources.feishu.app_secret");
    expect(secretPaths).toContain("mcp.http.auth_token_env");
  });

  it("registers selectable provider options", () => {
    const llmProvider = CONFIG_FIELDS.find((field) => field.path === "llm.provider");
    const embeddingProvider = CONFIG_FIELDS.find((field) => field.path === "embedding.provider");

    expect(llmProvider?.options?.map((option) => option.value)).toEqual([
      "openai",
      "anthropic",
      "mock",
    ]);
    expect(embeddingProvider?.options?.map((option) => option.value)).toEqual(["openai", "ollama"]);
    expect(
      CONFIG_FIELDS.find((field) => field.path === "server.mcp_transport")?.options?.map(
        (option) => option.value,
      ),
    ).toEqual(["stdio", "sse", "streamable_http"]);
  });

  it("marks required LLM and Embedding fields for the TUI", () => {
    const requiredPaths = CONFIG_FIELDS.filter((field) => field.required).map(
      (field) => field.path,
    );

    expect(requiredPaths).toEqual(
      expect.arrayContaining([
        "llm.provider",
        "llm.model",
        "llm.base_url",
        "llm.api_key",
        "embedding.provider",
        "embedding.model",
        "embedding.dimensions",
        "embedding.base_url",
        "embedding.api_key",
      ]),
    );
  });

  it("hides OpenAI-only embedding fields when Ollama is selected", () => {
    const openaiFields = getConfigFieldsForSection("embedding", {
      embedding: { provider: "openai" },
    }).map((field) => field.path);
    const ollamaFields = getConfigFieldsForSection("embedding", {
      embedding: { provider: "ollama" },
    }).map((field) => field.path);

    expect(openaiFields).toContain("embedding.api_key");
    expect(ollamaFields).not.toContain("embedding.api_key");
    expect(ollamaFields).toEqual([
      "embedding.provider",
      "embedding.model",
      "embedding.dimensions",
      "embedding.base_url",
    ]);
  });

  it("describes every configurable field for the detail pane", () => {
    for (const field of CONFIG_FIELDS) {
      expect(field.description, field.path).toEqual(expect.any(String));
      expect(field.description.trim().length, field.path).toBeGreaterThan(0);
    }
  });
});
