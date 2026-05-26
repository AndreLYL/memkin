/**
 * Tests for config loader and state directory management
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { ensureStateDir, statePath } from "../../src/core/state.js";

// Create a temporary test directory
const testDir = resolve(`/tmp/memoark-test-${Date.now()}`);

describe("Config loader", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // Save original cwd
    process.env.TEST_ORIGINAL_CWD = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore original cwd
    if (process.env.TEST_ORIGINAL_CWD) {
      process.chdir(process.env.TEST_ORIGINAL_CWD);
      delete process.env.TEST_ORIGINAL_CWD;
    }
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should load default config when no YAML file exists", () => {
    const config = loadConfig();

    expect(config.privacy.enabled).toBe(true);
    expect(config.privacy.mode).toBe("reversible");
    expect(config.privacy.redact_phone).toBe(true);
    expect(config.privacy.redact_id_card).toBe(true);
    expect(config.privacy.redact_bank_card).toBe(true);
    expect(config.privacy.redact_email).toBe(false);
    expect(config.privacy.redact_url).toBe(false);
    expect(config.privacy.blocked_words).toEqual([]);
    expect(config.privacy.replacement).toBe("[REDACTED]");

    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4o-mini");

    expect(config.block_builder.block_gap_minutes).toBe(30);
    expect(config.block_builder.max_block_tokens).toBe(4000);
    expect(config.block_builder.max_block_messages).toBe(100);

    expect(config.adapters).toEqual({});
  });

  it("should load and parse valid YAML config file", () => {
    const yaml = `
privacy:
  enabled: false
  mode: irreversible
  redact_phone: false
  blocked_words: ["secret", "confidential"]
llm:
  provider: anthropic
  model: claude-3-sonnet
block_builder:
  block_gap_minutes: 60
  max_block_tokens: 8000
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    expect(config.privacy.enabled).toBe(false);
    expect(config.privacy.mode).toBe("irreversible");
    expect(config.privacy.redact_phone).toBe(false);
    expect(config.privacy.blocked_words).toEqual(["secret", "confidential"]);
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-3-sonnet");
    expect(config.block_builder.block_gap_minutes).toBe(60);
    expect(config.block_builder.max_block_tokens).toBe(8000);
    // Non-overridden defaults should remain
    expect(config.privacy.redact_id_card).toBe(true);
    expect(config.block_builder.max_block_messages).toBe(100);
  });

  it("should merge user config with defaults", () => {
    const yaml = `
llm:
  provider: custom-provider
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    // User override
    expect(config.llm.provider).toBe("custom-provider");
    // Default still used
    expect(config.llm.model).toBe("gpt-4o-mini");
    expect(config.privacy.enabled).toBe(true);
    expect(config.block_builder.block_gap_minutes).toBe(30);
  });

  it("should interpolate environment variables", () => {
    process.env.TEST_API_KEY = "secret-key-123";
    process.env.TEST_PROVIDER = "my-provider";

    const yaml = `
llm:
  provider: \${TEST_PROVIDER}
  api_key: \${TEST_API_KEY}
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    expect(config.llm.provider).toBe("my-provider");
    expect(config.llm.api_key).toBe("secret-key-123");

    delete process.env.TEST_API_KEY;
    delete process.env.TEST_PROVIDER;
  });

  it("should replace missing environment variables with empty string", () => {
    const yaml = `
llm:
  api_key: \${MISSING_VAR}
  base_url: \${ANOTHER_MISSING}
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    expect(config.llm.api_key).toBe("");
    expect(config.llm.base_url).toBe("");
  });

  it("should interpolate environment variables in arrays", () => {
    process.env.TEST_WORD1 = "secret";
    process.env.TEST_WORD2 = "private";

    const yaml = `
privacy:
  blocked_words:
    - \${TEST_WORD1}
    - \${TEST_WORD2}
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    expect(config.privacy.blocked_words).toEqual(["secret", "private"]);

    delete process.env.TEST_WORD1;
    delete process.env.TEST_WORD2;
  });

  it("should handle partial environment variable replacement in strings", () => {
    process.env.TEST_ENV = "prod";

    const yaml = `
privacy:
  replacement: "[REDACTED-\${TEST_ENV}]"
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    expect(config.privacy.replacement).toBe("[REDACTED-prod]");

    delete process.env.TEST_ENV;
  });

  it("should support loading config from custom path", () => {
    const customDir = resolve(testDir, "configs");
    mkdirSync(customDir, { recursive: true });
    const customPath = resolve(customDir, "custom.yaml");

    const yaml = `
llm:
  model: custom-model
`;
    writeFileSync(customPath, yaml);
    const config = loadConfig(customPath);

    expect(config.llm.model).toBe("custom-model");
    expect(config.llm.provider).toBe("openai"); // default
  });

  it("should handle empty YAML file", () => {
    writeFileSync("memoark.yaml", "");
    const config = loadConfig();

    // All defaults should be applied
    expect(config.privacy.enabled).toBe(true);
    expect(config.llm.provider).toBe("openai");
  });

  it("should throw error for invalid YAML syntax", () => {
    const yaml = `
privacy:
  enabled: [invalid yaml
`;
    writeFileSync("memoark.yaml", yaml);

    expect(() => loadConfig()).toThrow();
  });

  it("should handle nested object merging correctly", () => {
    const yaml = `
privacy:
  enabled: false
  blocked_words:
    - word1
adapters:
  file:
    enabled: true
    output_dir: /tmp/output
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    // Verify nested privacy merging
    expect(config.privacy.enabled).toBe(false);
    expect(config.privacy.mode).toBe("reversible"); // default still applied
    expect(config.privacy.blocked_words).toEqual(["word1"]);

    // Verify adapters
    expect(config.adapters.file).toEqual({
      enabled: true,
      output_dir: "/tmp/output",
    });
    expect(config.adapters.gbrain).toBeUndefined();
  });

  it("should preserve config type integrity", () => {
    const yaml = `
block_builder:
  block_gap_minutes: 45
  max_block_tokens: 5000
  max_block_messages: 50
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();

    // Verify all values are correct type
    expect(typeof config.block_builder.block_gap_minutes).toBe("number");
    expect(typeof config.block_builder.max_block_tokens).toBe("number");
    expect(typeof config.block_builder.max_block_messages).toBe("number");
    expect(config.block_builder.block_gap_minutes).toBe(45);
    expect(config.block_builder.max_block_tokens).toBe(5000);
    expect(config.block_builder.max_block_messages).toBe(50);
  });

  it("should load sources config with defaults", () => {
    const config = loadConfig();
    expect(config.sources["claude-code"]?.enabled).toBe(true);
    expect(config.sources.codex?.enabled).toBe(true);
    expect(config.sources.hermes?.enabled).toBe(true);
  });

  it("should allow disabling a source", () => {
    const tmpConfig = resolve(os.tmpdir(), `memoark-test-${Date.now()}.yaml`);
    writeFileSync(tmpConfig, "sources:\n  codex:\n    enabled: false\n");
    try {
      const config = loadConfig(tmpConfig);
      expect(config.sources.codex?.enabled).toBe(false);
      expect(config.sources["claude-code"]?.enabled).toBe(true);
    } finally {
      unlinkSync(tmpConfig);
    }
  });

  it("should parse store and embedding config with env interpolation", () => {
    process.env.OPENAI_API_KEY = "test-key-123";
    const yaml = `
store:
  data_dir: /tmp/memoark-test
embedding:
  provider: openai
  model: text-embedding-3-large
  dimensions: 1536
  api_key: \${OPENAI_API_KEY}
server:
  http_port: 3927
  mcp_transport: stdio
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();
    expect(config.store.data_dir).toBe("/tmp/memoark-test");
    expect(config.embedding.provider).toBe("openai");
    expect(config.embedding.dimensions).toBe(1536);
    expect(config.embedding.api_key).toBe("test-key-123");
    expect(config.server.http_port).toBe(3927);
    delete process.env.OPENAI_API_KEY;
  });

  it("should use defaults when store/embedding sections are absent", () => {
    const yaml = `
llm:
  provider: mock
`;
    writeFileSync("memoark.yaml", yaml);
    const config = loadConfig();
    expect(config.store.data_dir).toBe("~/.memoark/data");
    expect(config.embedding.provider).toBe("openai");
    expect(config.embedding.dimensions).toBe(1536);
    expect(config.server.http_port).toBe(3927);
  });
});

describe("State directory management", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.TEST_ORIGINAL_CWD = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    if (process.env.TEST_ORIGINAL_CWD) {
      process.chdir(process.env.TEST_ORIGINAL_CWD);
      delete process.env.TEST_ORIGINAL_CWD;
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should create .memoark directory if it does not exist", () => {
    const stateDir = ensureStateDir();

    expect(existsSync(stateDir)).toBe(true);
    expect(stateDir).toBe(resolve(process.cwd(), ".memoark"));
  });

  it("should return existing .memoark directory without error", () => {
    // First call creates it
    const stateDir1 = ensureStateDir();
    // Second call should not error and return same path
    const stateDir2 = ensureStateDir();

    expect(stateDir1).toBe(stateDir2);
    expect(existsSync(stateDir2)).toBe(true);
  });

  it("should support custom base directory", () => {
    const customBase = resolve(testDir, "custom-base");
    mkdirSync(customBase, { recursive: true });

    const stateDir = ensureStateDir(customBase);

    expect(stateDir).toBe(resolve(customBase, ".memoark"));
    expect(existsSync(stateDir)).toBe(true);
  });

  it("should return correct path for state file", () => {
    ensureStateDir();
    const path = statePath("cursors.yaml");

    expect(path).toBe(resolve(process.cwd(), ".memoark", "cursors.yaml"));
  });

  it("should return correct path for different state files", () => {
    ensureStateDir();

    expect(statePath("checkpoints.jsonl")).toBe(
      resolve(process.cwd(), ".memoark", "checkpoints.jsonl"),
    );
    expect(statePath("cursors.yaml")).toBe(resolve(process.cwd(), ".memoark", "cursors.yaml"));
    expect(statePath("redaction_map.jsonl")).toBe(
      resolve(process.cwd(), ".memoark", "redaction_map.jsonl"),
    );
  });

  it("should allow writing to state path", () => {
    ensureStateDir();
    const path = statePath("test.txt");

    writeFileSync(path, "test content");

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("test content");
  });

  it("should handle nested .memoark directory creation", () => {
    const nestedBase = resolve(testDir, "a", "b", "c");
    const stateDir = ensureStateDir(nestedBase);

    expect(existsSync(stateDir)).toBe(true);
    expect(stateDir).toBe(resolve(nestedBase, ".memoark"));
  });
});
