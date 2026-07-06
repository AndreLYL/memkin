import { describe, expect, it } from "vitest";
import { createDefaultConfigDocument, updateDraft } from "../../src/config-center/document.js";
import {
  DETAIL_PANE_HEIGHT,
  DETAIL_PANE_WIDTH,
  MEMKIN_SLANT_HEADER,
  renderConfigCenter,
} from "../../src/config-center/tui/render.js";

function getDetailLines(output: string): string[] {
  const parts = output.split(
    "--------------------------------------------------------------------------------",
  );
  return parts[2].replace(/^\n/, "").replace(/\n$/, "").split("\n");
}

describe("config-center render", () => {
  it("renders the shared Slant header", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc);

    expect(output).toContain(MEMKIN_SLANT_HEADER);
    expect(output).toContain("════════════════════════════════════════");
  });

  it("renders the title and config path/status on separate lines", () => {
    const doc = { ...createDefaultConfigDocument("/tmp/memkin.yaml"), exists: true };
    const output = renderConfigCenter(doc);

    expect(output).toContain("\nMemkin Config Center\n/tmp/memkin.yaml  loaded\n");
    expect(output).not.toContain("Memkin Config Center                         /tmp/memkin.yaml");
  });

  it("renders Feishu as a coming-soon placeholder in MVP", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, { sectionId: "feishu" });

    expect(output).toContain("Feishu");
    expect(output).toContain("Coming soon — edit memkin.yaml directly.");
  });

  it("hides the right-side field cursor while the sidebar is focused", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "llm",
      fieldIndex: 0,
      focus: "sections",
    });

    expect(output).toContain("> LLM");
    expect(output).toContain("│    Provider*            openai");
    expect(output).not.toContain("│  > Provider");
  });

  it("keeps the selected sidebar arrow and shows the first right-side cursor after entering field focus", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "llm",
      fieldIndex: 0,
      focus: "fields",
    });

    expect(output).toContain("> LLM");
    expect(output).toContain("│  > Provider*            openai");
  });

  it("renders a fixed-size detail pane with only default and description", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, { sectionId: "llm", fieldIndex: 0 });
    const lines = getDetailLines(output);

    expect(lines).toHaveLength(DETAIL_PANE_HEIGHT);
    expect(lines.every((line) => line.length === DETAIL_PANE_WIDTH)).toBe(true);
    expect(lines[0]).toContain("Default: openai");
    expect(lines[1]).toContain("Description: Supported: openai, anthropic, mock.");
    expect(output).not.toContain("Field:");
    expect(output).not.toContain("Type:");
    expect(output).not.toContain("Current:");
    expect(output).not.toContain("Options:");
  });

  it("shows the configured default instead of the edited current value", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const updated = updateDraft(doc, "llm.model", "gpt-test");
    const output = renderConfigCenter(updated, { sectionId: "llm", fieldIndex: 1 });
    const detailText = getDetailLines(output).join("\n");

    expect(detailText).toContain("Default: gpt-4o-mini");
    expect(detailText).toContain("Description: Model name passed to the configured LLM provider.");
    expect(detailText).not.toContain("gpt-test");
  });

  it("keeps embedding provider recommendations concise in Description", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "embedding",
      fieldIndex: 0,
      focus: "fields",
      recommendations: [
        {
          path: "embedding.provider",
          value: "ollama",
          reason: "Use local embeddings.",
          source: "hardware",
        },
      ],
    });
    const detailText = getDetailLines(output).join("\n");

    expect(output).toContain("Provider*            openai");
    expect(output).not.toContain("Provider*            openai [Recommended: ollama]");
    expect(detailText).toContain("Default: openai");
    expect(detailText).toContain("Description: Supported: openai, ollama.Recommended: ollama.");
    expect(detailText).not.toContain("Use local");
    expect(detailText).not.toContain("Selects the embedding");
  });

  it("does not mark the LLM provider recommendation in the field list", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "llm",
      fieldIndex: 0,
      focus: "fields",
      recommendations: [
        {
          path: "llm.provider",
          value: "openai",
          reason: "No provider API key detected; OpenAI remains the product default.",
          source: "default",
        },
      ],
    });

    expect(output).toContain("Provider*            openai");
    expect(output).not.toContain("Provider*            openai [Recommended]");
    expect(output).not.toContain("Recommended openai");
  });

  it("renders connection status instead of validation and recommendation status", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "llm",
      fieldIndex: 0,
      focus: "fields",
      statusMessage: "Updated Provider",
      recommendations: [
        {
          path: "llm.provider",
          value: "openai",
          reason: "No provider API key detected; OpenAI remains the product default.",
          source: "default",
        },
      ],
      connectionStatus: {
        llm: { status: "ok" },
        embedding: { status: "failed", message: "No API key provided" },
      },
    });

    expect(output).toContain("Connections: LLM ok | Embedding failed: No API key provided");
    expect(output).not.toContain("Status: valid");
    expect(output).not.toContain("Updated Provider");
    expect(output).not.toContain("Recommended openai");
  });

  it("renders the compact navigation footer", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc);

    expect(output).toContain(
      "Enter edit/toggle  Tab/Up/Down field/section  Left/Right switch bar  Ctrl+S save  Esc/q quit",
    );
    expect(output).not.toContain("Sidebar: Up/Down/Tab section");
  });

  it("does not mark the current embedding provider when it already matches the recommendation", () => {
    const doc = updateDraft(
      createDefaultConfigDocument("/tmp/memkin.yaml"),
      "embedding.provider",
      "ollama",
    );
    const output = renderConfigCenter(doc, {
      sectionId: "embedding",
      fieldIndex: 0,
      focus: "fields",
      recommendations: [
        {
          path: "embedding.provider",
          value: "ollama",
          reason: "Apple Silicon detected; local embeddings are suitable.",
          source: "hardware",
        },
      ],
    });

    expect(output).toContain("Provider*            ollama");
    expect(output).not.toContain("Provider*            ollama [Recommended]");
  });

  it("hides provider-specific embedding fields that do not apply", () => {
    const doc = updateDraft(
      createDefaultConfigDocument("/tmp/memkin.yaml"),
      "embedding.provider",
      "ollama",
    );
    const output = renderConfigCenter(doc, {
      sectionId: "embedding",
      fieldIndex: 3,
      focus: "fields",
    });

    expect(output).toContain("Provider*            ollama");
    expect(output).toContain("Model*");
    expect(output).toContain("Dimensions*");
    expect(output).toContain("Base URL*");
    expect(output).not.toContain("API Key");
  });

  it("shows a manual-config message for enabled sources without detected base dirs", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "sources",
      fieldIndex: 1,
      focus: "fields",
    });

    expect(output).toContain("Claude Code Base Dir 读取失败，需要手动配置");
  });

  it("shows disabled source base dirs as dash", () => {
    const doc = updateDraft(
      createDefaultConfigDocument("/tmp/memkin.yaml"),
      "sources.claude-code.enabled",
      false,
    );
    const output = renderConfigCenter(doc, {
      sectionId: "sources",
      fieldIndex: 1,
      focus: "fields",
    });

    expect(output).toContain("Claude Code Base Dir -");
    expect(output).not.toContain("Claude Code Base Dir 读取失败，需要手动配置");
  });

  it("marks required fields with a stable field-list marker", () => {
    const doc = createDefaultConfigDocument("/tmp/memkin.yaml");
    const output = renderConfigCenter(doc, {
      sectionId: "embedding",
      fieldIndex: 0,
      focus: "fields",
    });

    expect(output).toContain("Provider*            openai");
    expect(output).toContain("Model*               text-embedding-3-large");
    expect(output).toContain("Dimensions*          1536");
    expect(output).toContain("API Key*             (not set)");
    expect(output).toContain("Base URL*            -");
  });
});
