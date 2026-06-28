import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfigRoutes } from "../../src/server/config-routes.js";

const testDir = join(tmpdir(), `config-routes-test-${Date.now()}`);
const configPath = join(testDir, "memoark.yaml");

function makeApp() {
  return createConfigRoutes({ configPath });
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("GET /api/config — masking", () => {
  it("returns empty object when config file does not exist", async () => {
    const app = makeApp();
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("masks database_url password on GET", async () => {
    writeFileSync(
      configPath,
      [
        "store:",
        "  engine: postgres",
        "  database_url: postgres://user:supersecret@host:5432/db",
      ].join("\n"),
      "utf-8",
    );

    const app = makeApp();
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store.database_url).not.toContain("supersecret");
    expect(body.store.database_url).toContain("****");
  });

  it("leaves ${DATABASE_URL} placeholder untouched on GET", async () => {
    const DATABASE_URL_PLACEHOLDER = "$" + "{DATABASE_URL}";
    writeFileSync(
      configPath,
      ["store:", "  engine: postgres", `  database_url: ${DATABASE_URL_PLACEHOLDER}`].join("\n"),
      "utf-8",
    );

    const app = makeApp();
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store.database_url).toBe(DATABASE_URL_PLACEHOLDER);
  });

  it("masks llm api_key on GET (existing behavior preserved)", async () => {
    writeFileSync(
      configPath,
      ["llm:", "  provider: openai", "  model: gpt-4o-mini", "  api_key: sk-realkey12345"].join(
        "\n",
      ),
      "utf-8",
    );

    const app = makeApp();
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.llm.api_key).not.toContain("realkey");
    expect(body.llm.api_key).toContain("****");
  });
});

describe("POST /api/config — database_url save-restore", () => {
  it("restores real database_url when masked value is sent back", async () => {
    const realUrl = "postgres://user:supersecret@host:5432/db";
    writeFileSync(
      configPath,
      [
        "store:",
        "  engine: postgres",
        `  database_url: "${realUrl}"`,
        "llm:",
        "  provider: openai",
        "  model: gpt-4o-mini",
        "sources:",
        "  claude-code:",
        "    enabled: true",
      ].join("\n"),
      "utf-8",
    );

    const app = makeApp();

    // Simulate: UI reads config (gets masked), sends masked value back
    const maskedUrl = "postgres://user:****@host:5432/db";
    const postRes = await app.request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store: { engine: "postgres", database_url: maskedUrl },
        llm: { provider: "openai", model: "gpt-4o-mini" },
        sources: { "claude-code": { enabled: true } },
      }),
    });

    expect(postRes.status).toBe(200);
    const result = await postRes.json();
    expect(result.ok).toBe(true);

    // Verify the saved file contains the real URL, not the masked one
    const { readFileSync } = await import("node:fs");
    const saved = readFileSync(configPath, "utf-8");
    expect(saved).toContain("supersecret");
    expect(saved).not.toContain("****");
  });
});
