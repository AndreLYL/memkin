import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `memoark-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "memoark.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("feishu.auto_include_new_groups", () => {
    it("parses sources.feishu.auto_include_new_groups when true", () => {
      writeFileSync(
        configPath,
        [
          "sources:",
          "  feishu:",
          "    app_id: cli_x",
          "    app_secret: secret_x",
          "    auto_include_new_groups: true",
          "    sources:",
          "      messages:",
          "        enabled: false",
          "        chat_ids: []",
        ].join("\n"),
      );
      const config = loadConfig(configPath);
      expect(config.sources.feishu?.auto_include_new_groups).toBe(true);
    });

    it("defaults auto_include_new_groups to undefined when absent", () => {
      writeFileSync(
        configPath,
        [
          "sources:",
          "  feishu:",
          "    app_id: cli_x",
          "    app_secret: secret_x",
          "    sources:",
          "      messages:",
          "        enabled: false",
          "        chat_ids: []",
        ].join("\n"),
      );
      const config = loadConfig(configPath);
      expect(config.sources.feishu?.auto_include_new_groups).toBeUndefined();
    });
  });
});
