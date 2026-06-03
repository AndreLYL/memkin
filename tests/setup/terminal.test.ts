import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPrompt, supportsColor } from "../../src/setup/terminal.js";

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

describe("setup terminal utilities", () => {
  it("detects color support from tty and environment", () => {
    expect(supportsColor({ isTTY: false })).toBe(false);
    expect(supportsColor({ isTTY: true, env: { NO_COLOR: "1" } })).toBe(false);
    expect(supportsColor({ isTTY: true, env: { FORCE_COLOR: "1" } })).toBe(true);
    expect(supportsColor({ isTTY: true, env: {}, platform: "linux" })).toBe(true);
    expect(supportsColor({ isTTY: true, env: {}, platform: "win32" })).toBe(false);
    expect(supportsColor({ isTTY: true, env: { WT_SESSION: "1" }, platform: "win32" })).toBe(true);
  });

  it("supports ask, confirm, and numbered select with injected streams", async () => {
    const input = Readable.from(["\n", "n\n", "2\n"]);
    const output = new MemoryWritable();
    const prompt = createPrompt(input, output);

    await expect(prompt.ask("Model", "gpt-4o-mini")).resolves.toBe("gpt-4o-mini");
    await expect(prompt.confirm("Save?", true)).resolves.toBe(false);
    await expect(
      prompt.select(
        "Provider",
        [
          { value: "openai", label: "OpenAI" },
          { value: "anthropic", label: "Anthropic" },
        ],
        0,
      ),
    ).resolves.toBe("anthropic");

    prompt.close();
    expect(output.text()).toContain("Choice [1]");
  });
});
