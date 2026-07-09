import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `memkin-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "memkin.yaml");
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

  describe("distiller config (extraction-quality-redesign PR-2)", () => {
    it("defaults distiller.payload_ttl_days to 90", () => {
      writeFileSync(configPath, "privacy:\n  enabled: true\n");
      const config = loadConfig(configPath);
      expect(config.distiller.payload_ttl_days).toBe(90);
    });

    it("honours an explicit distiller.payload_ttl_days override", () => {
      writeFileSync(configPath, ["distiller:", "  payload_ttl_days: 30"].join("\n"));
      const config = loadConfig(configPath);
      expect(config.distiller.payload_ttl_days).toBe(30);
    });
  });
});
