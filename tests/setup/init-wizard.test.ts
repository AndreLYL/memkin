import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigPath, isFirstRun, runInit } from "../../src/setup/init-wizard.js";

const OPENAI_API_KEY_PLACEHOLDER = "$" + "{OPENAI_API_KEY}";

class MemoryWritable extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error) => void) {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("init wizard", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalOpenAI: string | undefined;
  let originalAnthropic: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memoark-init-"));
    originalCwd = process.cwd();
    originalOpenAI = process.env.OPENAI_API_KEY;
    originalAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
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

  it("resolves config paths and first-run state", () => {
    expect(getConfigPath()).toBe(resolve(process.cwd(), "memoark.yaml"));
    expect(isFirstRun()).toBe(true);
  });

  it("writes config in automatic mode", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const output = new MemoryWritable();

    await runInit({ auto: true, output });

    expect(existsSync("memoark.yaml")).toBe(true);
    const yaml = readFileSync("memoark.yaml", "utf-8");
    expect(yaml).toContain(`api_key: ${OPENAI_API_KEY_PLACEHOLDER}`);
    expect(yaml).toContain("claude-code:");
    expect(output.text()).toContain("[ok] Configuration saved");
  });

  it("fails automatic mode without an API key", async () => {
    await expect(runInit({ auto: true, output: new MemoryWritable() })).rejects.toThrow(
      "No API key found",
    );
  });

  it("runs the interactive flow with injected input", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const input = Readable.from(["\n", "\n", "\n", "\n", "\n", "\n", "\n"]);
    const output = new MemoryWritable();

    await runInit({ input, output });

    const yaml = readFileSync("memoark.yaml", "utf-8");
    expect(yaml).toContain("provider: openai");
    expect(yaml).toContain("model: gpt-4o-mini");
    expect(yaml).toContain(`api_key: ${OPENAI_API_KEY_PLACEHOLDER}`);
    expect(output.text()).toContain("Welcome to Memoark Setup");
  });
});
