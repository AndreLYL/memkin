import { describe, expect, it } from "vitest";
import {
  type McpEntry,
  parseJsonConfig,
  removeMcpServer,
  upsertMcpServer,
} from "../../src/install/json-config.js";

const entry: McpEntry = { command: "memoark", args: ["serve", "--mcp"] };

describe("json-config mcp upsert/remove", () => {
  it("adds memoark without disturbing other servers or keys", () => {
    const obj = { theme: "dark", mcpServers: { other: { command: "x", args: [] } } };
    const out = upsertMcpServer(obj, "memoark", entry);
    expect(out.mcpServers).toEqual({
      other: { command: "x", args: [] },
      memoark: entry,
    });
    expect(out.theme).toBe("dark");
  });

  it("creates mcpServers when missing", () => {
    const out = upsertMcpServer({}, "memoark", entry);
    expect(out.mcpServers).toEqual({ memoark: entry });
  });

  it("overwrites an existing memoark entry", () => {
    const obj = { mcpServers: { memoark: { command: "old", args: [] } } };
    const out = upsertMcpServer(obj, "memoark", entry);
    expect((out.mcpServers as Record<string, unknown>).memoark).toEqual(entry);
  });

  it("removes memoark, keeps the rest", () => {
    const obj = { mcpServers: { memoark: entry, other: { command: "x", args: [] } } };
    const out = removeMcpServer(obj, "memoark");
    expect(out.mcpServers).toEqual({ other: { command: "x", args: [] } });
  });

  it("parses empty file as {} and throws a path-tagged error on invalid JSON", () => {
    expect(parseJsonConfig("", "/tmp/x.json")).toEqual({});
    expect(() => parseJsonConfig("{nope", "/tmp/bad.json")).toThrow(/\/tmp\/bad\.json/);
  });
});
