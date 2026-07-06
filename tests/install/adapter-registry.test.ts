import { describe, expect, it } from "vitest";
import { ADAPTERS } from "../../src/install/clients/index.js";
import { mcpEntry, type PlanCtx } from "../../src/install/types.js";

describe("adapter registry", () => {
  it("every adapter declares a boolean supportsHttp", () => {
    for (const a of ADAPTERS) expect(typeof a.supportsHttp).toBe("boolean");
  });
});
describe("mcpEntry(ctx)", () => {
  const base: Omit<PlanCtx, "transport" | "url"> = {
    home: "/h",
    platform: "darwin",
    scope: "global",
    cwd: "/c",
    action: "upsert",
    launch: { command: "memkin", args: ["serve", "--mcp"] },
  };
  it("http transport → http entry", () => {
    expect(mcpEntry({ ...base, transport: "http", url: "http://127.0.0.1:3928/mcp" })).toEqual({
      kind: "http",
      url: "http://127.0.0.1:3928/mcp",
    });
  });
  it("stdio transport → stdio entry from launch", () => {
    expect(mcpEntry({ ...base, transport: "stdio" })).toEqual({
      kind: "stdio",
      command: "memkin",
      args: ["serve", "--mcp"],
    });
  });
  it("http transport without url throws", () => {
    expect(() => mcpEntry({ ...base, transport: "http" })).toThrow(/url/i);
  });
});
