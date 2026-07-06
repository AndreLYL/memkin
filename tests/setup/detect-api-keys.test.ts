import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectApiKeys } from "../../src/setup/detect-api-keys.js";

describe("detect api keys", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "memkin-keys-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("prefers environment variables", () => {
    expect(
      detectApiKeys({
        env: {
          OPENAI_API_KEY: "sk-openai",
          ANTHROPIC_API_KEY: "sk-ant",
        },
        homeDir,
      }),
    ).toEqual({
      openai: "sk-openai",
      anthropic: "sk-ant",
      source: "environment",
    });
  });

  it("reads shell config files on POSIX", () => {
    writeFileSync(
      join(homeDir, ".zshrc"),
      'export OPENAI_API_KEY="sk-from-shell"\nexport ANTHROPIC_API_KEY=ant-from-shell\n',
    );

    expect(detectApiKeys({ env: {}, homeDir, platform: "darwin" })).toEqual({
      openai: "sk-from-shell",
      anthropic: "ant-from-shell",
      source: ".zshrc",
    });
  });

  it("skips shell config scanning on Windows", () => {
    writeFileSync(join(homeDir, ".zshrc"), "export OPENAI_API_KEY=sk-from-shell\n");

    expect(detectApiKeys({ env: {}, homeDir, platform: "win32" })).toEqual({
      source: "none",
    });
  });
});
