import { describe, expect, it } from "vitest";
import {
  buildConnectionCheckPlan,
  connectionCheckSignature,
  DEFAULT_CONNECTION_STATUS,
  formatConnectionItem,
} from "../../src/config-center/connection-checks.js";
import { createDefaultConfigDocument, updateDraft } from "../../src/config-center/document.js";

const OPENAI_API_KEY_PLACEHOLDER = "$" + "{OPENAI_API_KEY}";

describe("config-center connection checks", () => {
  it("does not build an LLM check until provider, model, base URL, and API key are present", () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const withBaseUrl = updateDraft(doc, "llm.base_url", "https://api.openai.com/v1");

    expect(buildConnectionCheckPlan(doc.draft).llm).toBeUndefined();
    expect(buildConnectionCheckPlan(withBaseUrl.draft).llm).toBeUndefined();
  });

  it("builds an LLM check after all required LLM fields are present", () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const withBaseUrl = updateDraft(doc, "llm.base_url", "https://api.openai.com/v1");
    const complete = updateDraft(withBaseUrl, "llm.api_key", OPENAI_API_KEY_PLACEHOLDER);

    expect(
      buildConnectionCheckPlan(complete.draft, {
        OPENAI_API_KEY: "sk-resolved",
      }).llm,
    ).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-resolved",
    });
  });

  it("does not build an OpenAI embedding check until model, dimensions, base URL, and API key are present", () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const withoutDimensions = updateDraft(doc, "embedding.dimensions", 0);
    const withBaseUrl = updateDraft(
      withoutDimensions,
      "embedding.base_url",
      "https://api.openai.com/v1",
    );
    const withApiKey = updateDraft(withBaseUrl, "embedding.api_key", "sk-embedding");

    expect(buildConnectionCheckPlan(doc.draft).embedding).toBeUndefined();
    expect(buildConnectionCheckPlan(withBaseUrl.draft).embedding).toBeUndefined();
    expect(buildConnectionCheckPlan(withApiKey.draft).embedding).toBeUndefined();
  });

  it("builds OpenAI embedding checks from complete provider settings", () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const withBaseUrl = updateDraft(doc, "embedding.base_url", "https://api.openai.com/v1");
    const complete = updateDraft(withBaseUrl, "embedding.api_key", "sk-embedding");
    const plan = buildConnectionCheckPlan(complete.draft);

    expect(plan.embedding).toEqual({
      provider: "openai",
      model: "text-embedding-3-large",
      dimensions: 1536,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-embedding",
    });
    expect(connectionCheckSignature(plan)).toContain("text-embedding-3-large");
    expect(connectionCheckSignature(plan)).toContain("1536");
  });

  it("builds Ollama embedding checks without requiring an API key", () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const provider = updateDraft(doc, "embedding.provider", "ollama");
    const model = updateDraft(provider, "embedding.model", "nomic-embed-text");
    const dimensions = updateDraft(model, "embedding.dimensions", 768);
    const complete = updateDraft(dimensions, "embedding.base_url", "http://localhost:11434");

    expect(buildConnectionCheckPlan(provider.draft).embedding).toBeUndefined();
    expect(buildConnectionCheckPlan(complete.draft).embedding).toEqual({
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      baseUrl: "http://localhost:11434",
    });
  });

  it("formats connection status items for the TUI status line", () => {
    expect(formatConnectionItem(DEFAULT_CONNECTION_STATUS.llm)).toBe("not checked");
    expect(formatConnectionItem({ status: "checking" })).toBe("checking...");
    expect(formatConnectionItem({ status: "ok" })).toBe("ok");
    expect(formatConnectionItem({ status: "failed", message: "No API key" })).toBe(
      "failed: No API key",
    );
  });
});
