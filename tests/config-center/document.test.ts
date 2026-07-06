import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultConfigDocument,
  loadConfigDocument,
  saveConfigDocument,
  updateDraft,
} from "../../src/config-center/document.js";

const OPENAI_API_KEY_PLACEHOLDER = "$" + "{OPENAI_API_KEY}";

describe("config-center document", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memkin-config-center-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a default draft for a missing config file", async () => {
    const configPath = join(tempDir, "memkin.yaml");
    const doc = await loadConfigDocument(configPath);

    expect(doc.exists).toBe(false);
    expect(doc.path).toBe(configPath);
    expect(doc.draft.llm?.provider).toBe("openai");
    expect(doc.draft.sources?.["claude-code"]?.enabled).toBe(true);
  });

  it("loads raw placeholders without interpolating them", async () => {
    const configPath = join(tempDir, "memkin.yaml");
    writeFileSync(
      configPath,
      [
        "llm:",
        "  provider: openai",
        "  model: gpt-4o-mini",
        `  api_key: ${OPENAI_API_KEY_PLACEHOLDER}`,
      ].join("\n"),
    );

    const doc = await loadConfigDocument(configPath);

    expect(doc.exists).toBe(true);
    expect(doc.draft.llm?.api_key).toBe(OPENAI_API_KEY_PLACEHOLDER);
  });

  it("updates draft values immutably", () => {
    const doc = createDefaultConfigDocument(join(tempDir, "memkin.yaml"));
    const updated = updateDraft(doc, "llm.model", "gpt-test");

    expect(updated.draft.llm?.model).toBe("gpt-test");
    expect(doc.draft.llm?.model).not.toBe("gpt-test");
  });

  it("saves parseable YAML and preserves unknown top-level fields", async () => {
    const configPath = join(tempDir, "memkin.yaml");
    writeFileSync(
      configPath,
      ["custom_section:", "  keep: true", "llm:", "  provider: mock", "  model: mock-model"].join(
        "\n",
      ),
    );

    const doc = await loadConfigDocument(configPath);
    const updated = updateDraft(doc, "llm.model", "mock-updated");

    await saveConfigDocument(updated);

    expect(existsSync(configPath)).toBe(true);
    const yaml = readFileSync(configPath, "utf-8");
    expect(yaml).toContain("custom_section:");
    expect(yaml).toContain("keep: true");
    expect(yaml).toContain("model: mock-updated");
  });
});
