import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import {
  getMissingEnvVarsForCommand,
  validateEnvForCommand,
} from "../../src/core/env-validation.js";

const OPENAI_API_KEY_PLACEHOLDER = "$" + "{OPENAI_API_KEY}";

describe("env validation", () => {
  let tempDir: string;
  let originalOpenAI: string | undefined;
  let originalAnthropic: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memoark-env-"));
    originalOpenAI = process.env.OPENAI_API_KEY;
    originalAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAI === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAI;
    }
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws for missing LLM placeholder used by extract", () => {
    const configPath = join(tempDir, "memoark.yaml");
    writeFileSync(
      configPath,
      `llm:\n  provider: openai\n  api_key: ${OPENAI_API_KEY_PLACEHOLDER}\n`,
    );
    const config = loadConfig(configPath);

    expect(() => validateEnvForCommand(config, "extract")).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnvForCommand(config, "extract")).toThrow(configPath);
  });

  it("throws when the selected LLM provider has no key in config or shell", () => {
    const configPath = join(tempDir, "memoark.yaml");
    writeFileSync(configPath, "llm:\n  provider: anthropic\n  model: claude-3-haiku-20240307\n");
    const config = loadConfig(configPath);

    expect(getMissingEnvVarsForCommand(config, "extract")).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("does not require OpenAI embedding env for fts-only search", () => {
    const configPath = join(tempDir, "memoark.yaml");
    writeFileSync(
      configPath,
      `embedding:\n  provider: openai\n  api_key: ${OPENAI_API_KEY_PLACEHOLDER}\n`,
    );
    const config = loadConfig(configPath);

    expect(getMissingEnvVarsForCommand(config, "search", { searchMode: "fts" })).toEqual([]);
    expect(getMissingEnvVarsForCommand(config, "search", { searchMode: "hybrid" })).toEqual([
      "OPENAI_API_KEY",
    ]);
  });

  it("returns diagnostics for doctor without throwing", () => {
    const configPath = join(tempDir, "memoark.yaml");
    writeFileSync(configPath, `llm:\n  api_key: ${OPENAI_API_KEY_PLACEHOLDER}\n`);
    const config = loadConfig(configPath);

    expect(getMissingEnvVarsForCommand(config, "doctor")).toContain("OPENAI_API_KEY");
  });
});
