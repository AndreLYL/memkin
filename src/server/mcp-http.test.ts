import { describe, expect, it } from "vitest";
import type { StoreContext } from "./mcp.js";
import { createMcpHttpApp } from "./mcp-http.js";

// Minimal stub — /health does not touch stores
const stubStores = {} as unknown as StoreContext;

const baseOptions = {
  allowedOrigins: [] as string[],
  allowedHosts: [] as string[],
};

// ─── /health pgProbe tests ───────────────────────────────────────────────────

describe("/health pgProbe", () => {
  it("pgProbe true + dbProbe true → 200, body has pg_ok: true", async () => {
    const app = createMcpHttpApp(stubStores, {
      ...baseOptions,
      health: {
        dbProbe: async () => true,
        pgProbe: async () => true,
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pg_ok).toBe(true);
    expect(body.db_ok).toBe(true);
  });

  it("pgProbe false → 503 even when dbProbe true, body has pg_ok: false", async () => {
    const app = createMcpHttpApp(stubStores, {
      ...baseOptions,
      health: {
        dbProbe: async () => true,
        pgProbe: async () => false,
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pg_ok).toBe(false);
  });

  it("no pgProbe → body has no pg_ok key, readiness unaffected by pg", async () => {
    const app = createMcpHttpApp(stubStores, {
      ...baseOptions,
      health: {
        dbProbe: async () => true,
        // no pgProbe
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect("pg_ok" in body).toBe(false);
  });

  it("pgProbe absent + dbProbe false → 503, still no pg_ok key", async () => {
    const app = createMcpHttpApp(stubStores, {
      ...baseOptions,
      health: {
        dbProbe: async () => false,
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect("pg_ok" in body).toBe(false);
  });
});
