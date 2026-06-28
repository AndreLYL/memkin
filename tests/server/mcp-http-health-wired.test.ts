import { describe, expect, it } from "vitest";
import { createMcpHttpApp } from "../../src/server/mcp-http.js";

// Minimal StoreContext stub — createMcpHttpApp only dereferences stores inside /mcp handler.
const minimalStores = {} as never;

describe("/health wired into daemon (B1)", () => {
  it("503 when dbProbe throws", async () => {
    const app = createMcpHttpApp(minimalStores, {
      allowedOrigins: [],
      allowedHosts: [],
      health: {
        instanceId: "n1",
        engine: "pglite",
        version: "0.3.2",
        dbProbe: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.db_ok).toBe(false);
    expect(body.status).toBe("degraded");
  });

  it("503 when dbProbe returns false", async () => {
    const app = createMcpHttpApp(minimalStores, {
      allowedOrigins: [],
      allowedHosts: [],
      health: {
        instanceId: "n1",
        engine: "postgres",
        version: "0.3.2",
        dbProbe: async () => false,
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect((await res.json()).db_ok).toBe(false);
  });

  it("200 with instance_id and engine when dbProbe returns true", async () => {
    const app = createMcpHttpApp(minimalStores, {
      allowedOrigins: [],
      allowedHosts: [],
      health: {
        instanceId: "daemon-abc",
        pid: 1234,
        engine: "pglite",
        version: "0.3.2",
        dbProbe: async () => true,
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instance_id).toBe("daemon-abc");
    expect(body.engine).toBe("pglite");
    expect(body.db_ok).toBe(true);
    expect(body.status).toBe("ok");
  });
});
