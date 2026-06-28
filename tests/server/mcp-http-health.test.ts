import { describe, expect, it } from "vitest";
import { createMcpHttpApp } from "../../src/server/mcp-http.js";

// Minimal StoreContext stub — same pattern as mcp-http.test.ts but without a real DB.
// createMcpHttpApp only dereferences stores inside the /mcp handler, not at construction time.
const minimalStores = {} as never;

function appWith(dbProbe: () => Promise<boolean>) {
  return createMcpHttpApp(minimalStores, {
    allowedOrigins: [],
    allowedHosts: [],
    readOnly: false,
    health: {
      instanceId: "n1",
      pid: 4242,
      engine: "postgres",
      version: "9.9",
      port: 3928,
      bind: "127.0.0.1",
      dbProbe,
    },
  });
}

describe("/health", () => {
  it("200 + identity when DB ok", async () => {
    const res = await appWith(async () => true).request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      instance_id: "n1",
      pid: 4242,
      engine: "postgres",
      read_only: false,
      db_ok: true,
      // FIX 5: port/bind must be present in /health response
      port: 3928,
      bind: "127.0.0.1",
    });
  });

  it("503 when DB probe fails", async () => {
    const res = await appWith(async () => false).request("/health");
    expect(res.status).toBe(503);
    expect((await res.json()).db_ok).toBe(false);
  });

  it("no health block → still 200 ok (backward compatible)", async () => {
    const app = createMcpHttpApp(minimalStores, { allowedOrigins: [], allowedHosts: [] });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
