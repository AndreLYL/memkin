import { describe, expect, it } from "vitest";
import {
  isEnvPlaceholder,
  maskSecret,
  maskSecretsInText,
} from "../../src/config-center/secrets.js";

const OPENAI_API_KEY_PLACEHOLDER = "$" + "{OPENAI_API_KEY}";

describe("config-center secrets", () => {
  it("keeps environment placeholders visible", () => {
    expect(isEnvPlaceholder(OPENAI_API_KEY_PLACEHOLDER)).toBe(true);
    expect(maskSecret(OPENAI_API_KEY_PLACEHOLDER)).toBe(OPENAI_API_KEY_PLACEHOLDER);
  });

  it("masks raw API keys without exposing the full value", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const masked = maskSecret(secret);

    expect(masked).toContain("sk-abc");
    expect(masked).toContain("****");
    expect(masked).not.toContain(secret);
  });

  it("masks known secret fields in YAML-like text", () => {
    const text = [
      "llm:",
      "  api_key: sk-llm-secret-value",
      "embedding:",
      "  api_key: sk-embedding-secret-value",
      "sources:",
      "  feishu:",
      "    app_secret: feishu-secret-value",
    ].join("\n");

    const masked = maskSecretsInText(text);

    expect(masked).not.toContain("sk-llm-secret-value");
    expect(masked).not.toContain("sk-embedding-secret-value");
    expect(masked).not.toContain("feishu-secret-value");
    expect(masked).toContain("api_key:");
    expect(masked).toContain("app_secret:");
  });
});
