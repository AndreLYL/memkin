import { describe, expect, it } from "vitest";
import { assertLoopbackOrThrow, resolveMcpHttpRuntime } from "../../src/server/mcp-http-runtime.js";

const cfg = {
  bind_host: "127.0.0.1",
  port: 3928,
  allowed_origins: ["http://127.0.0.1:3928"],
  allowed_hosts: ["127.0.0.1:3928"],
  read_only: true,
  auth_token_env: "",
};

describe("resolveMcpHttpRuntime", () => {
  it("flags override YAML: port, read-write, regenerated allowlists", () => {
    const r = resolveMcpHttpRuntime(cfg, {
      mcpBind: "127.0.0.1",
      mcpPort: 4000,
      mcpReadWrite: true,
      daemonInstanceId: "n1",
    });
    expect(r.port).toBe(4000);
    expect(r.readOnly).toBe(false);
    expect(r.allowedHosts).toEqual(["127.0.0.1:4000", "localhost:4000"]);
    expect(r.allowedOrigins).toEqual(["http://127.0.0.1:4000", "http://localhost:4000"]);
    expect(r.instanceId).toBe("n1");
  });
  it("explicit --mcp-allowed-host wins over regeneration", () => {
    const r = resolveMcpHttpRuntime(cfg, { mcpPort: 4000, mcpAllowedHost: ["foo:4000"] });
    expect(r.allowedHosts).toEqual(["foo:4000"]);
  });
  it("no flags → YAML values", () => {
    const r = resolveMcpHttpRuntime(cfg, {});
    expect(r.port).toBe(3928);
    expect(r.readOnly).toBe(true);
    expect(r.allowedHosts).toEqual(["127.0.0.1:3928"]);
  });
});

describe("assertLoopbackOrThrow", () => {
  it("loopback ok", () => {
    expect(() => assertLoopbackOrThrow({ bind: "127.0.0.1" })).not.toThrow();
  });
  it("localhost ok", () => {
    expect(() => assertLoopbackOrThrow({ bind: "localhost" })).not.toThrow();
  });
  it("non-loopback throws", () => {
    expect(() => assertLoopbackOrThrow({ bind: "0.0.0.0" })).toThrow(/loopback/i);
  });
});
