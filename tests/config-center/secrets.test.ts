import { describe, expect, it } from "vitest";
import {
  isEnvPlaceholder,
  maskDatabaseUrl,
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

  it("masks database_url password in YAML-like text", () => {
    const text = ["store:", "  database_url: postgres://user:secret@host:5432/db"].join("\n");

    const masked = maskSecretsInText(text);

    expect(masked).not.toContain("secret@");
    expect(masked).toContain("database_url:");
    expect(masked).toContain("****@");
  });

  it("leaves ${ENV} placeholder untouched in YAML text", () => {
    const text = "  database_url: ${DATABASE_URL}";
    const masked = maskSecretsInText(text);
    expect(masked).toContain("${DATABASE_URL}");
  });
});

describe("maskDatabaseUrl", () => {
  it("masks password segment of inline DSN, leaves ${ENV} untouched", () => {
    expect(maskDatabaseUrl("postgres://user:secret@host:5432/db")).toBe(
      "postgres://user:****@host:5432/db",
    );
    expect(maskDatabaseUrl("${DATABASE_URL}")).toBe("${DATABASE_URL}");
    expect(maskDatabaseUrl("postgres://host:5432/db")).toBe("postgres://host:5432/db");
  });

  it("handles postgresql:// scheme", () => {
    expect(maskDatabaseUrl("postgresql://admin:pass@localhost/mydb")).toBe(
      "postgresql://admin:****@localhost/mydb",
    );
  });

  it("returns unchanged value for unparseable strings", () => {
    expect(maskDatabaseUrl("not-a-url")).toBe("not-a-url");
  });
});
