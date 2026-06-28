import { describe, expect, it } from "vitest";
import {
  type McpEntry,
  parseJsonConfig,
  removeMcpServer,
  upsertMcpServer,
} from "../../src/install/json-config.js";
import { httpEntry, stdioEntry } from "../../src/install/mcp-entry.js";

const entry: McpEntry = { kind: "stdio", command: "memoark", args: ["serve", "--mcp"] };
const entryWire = { command: "memoark", args: ["serve", "--mcp"] };

describe("json-config mcp upsert/remove", () => {
  it("adds memoark without disturbing other servers or keys", () => {
    const obj = { theme: "dark", mcpServers: { other: { command: "x", args: [] } } };
    const out = upsertMcpServer(obj, "memoark", entry);
    expect(out.mcpServers).toEqual({
      other: { command: "x", args: [] },
      memoark: entryWire,
    });
    expect(out.theme).toBe("dark");
  });

  it("creates mcpServers when missing", () => {
    const out = upsertMcpServer({}, "memoark", entry);
    expect(out.mcpServers).toEqual({ memoark: entryWire });
  });

  it("overwrites an existing memoark entry", () => {
    const obj = { mcpServers: { memoark: { command: "old", args: [] } } };
    const out = upsertMcpServer(obj, "memoark", entry);
    expect((out.mcpServers as Record<string, unknown>).memoark).toEqual(entryWire);
  });

  it("removes memoark, keeps the rest", () => {
    const obj = { mcpServers: { memoark: entryWire, other: { command: "x", args: [] } } };
    const out = removeMcpServer(obj, "memoark");
    expect(out.mcpServers).toEqual({ other: { command: "x", args: [] } });
  });

  it("parses empty file as {} and throws a path-tagged error on invalid JSON", () => {
    expect(parseJsonConfig("", "/tmp/x.json")).toEqual({});
    expect(() => parseJsonConfig("{nope", "/tmp/bad.json")).toThrow(/\/tmp\/bad\.json/);
  });

  it("http entry writes {type:'http', url} with NO kind field", () => {
    const out = upsertMcpServer({}, "memoark", httpEntry("http://127.0.0.1:3928/mcp")) as any;
    expect(out.mcpServers.memoark).toEqual({ type: "http", url: "http://127.0.0.1:3928/mcp" });
    expect(out.mcpServers.memoark).not.toHaveProperty("kind");
  });

  it("stdio entry writes {command, args} with NO kind field", () => {
    const out = upsertMcpServer({}, "memoark", stdioEntry("memoark", ["serve", "--mcp"])) as any;
    expect(out.mcpServers.memoark).toEqual({ command: "memoark", args: ["serve", "--mcp"] });
    expect(out.mcpServers.memoark).not.toHaveProperty("kind");
  });
});
