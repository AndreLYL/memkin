import { describe, expect, it } from "vitest";
import {
  type McpEntry,
  parseJsonConfig,
  removeMcpServer,
  upsertMcpServer,
} from "../../src/install/json-config.js";
import { httpEntry, stdioEntry } from "../../src/install/mcp-entry.js";

const entry: McpEntry = { kind: "stdio", command: "memkin", args: ["serve", "--mcp"] };
const entryWire = { command: "memkin", args: ["serve", "--mcp"] };

describe("json-config mcp upsert/remove", () => {
  it("adds memkin without disturbing other servers or keys", () => {
    const obj = { theme: "dark", mcpServers: { other: { command: "x", args: [] } } };
    const out = upsertMcpServer(obj, "memkin", entry);
    expect(out.mcpServers).toEqual({
      other: { command: "x", args: [] },
      memkin: entryWire,
    });
    expect(out.theme).toBe("dark");
  });

  it("creates mcpServers when missing", () => {
    const out = upsertMcpServer({}, "memkin", entry);
    expect(out.mcpServers).toEqual({ memkin: entryWire });
  });

  it("overwrites an existing memkin entry", () => {
    const obj = { mcpServers: { memkin: { command: "old", args: [] } } };
    const out = upsertMcpServer(obj, "memkin", entry);
    expect((out.mcpServers as Record<string, unknown>).memkin).toEqual(entryWire);
  });

  it("removes memkin, keeps the rest", () => {
    const obj = { mcpServers: { memkin: entryWire, other: { command: "x", args: [] } } };
    const out = removeMcpServer(obj, "memkin");
    expect(out.mcpServers).toEqual({ other: { command: "x", args: [] } });
  });

  it("parses empty file as {} and throws a path-tagged error on invalid JSON", () => {
    expect(parseJsonConfig("", "/tmp/x.json")).toEqual({});
    expect(() => parseJsonConfig("{nope", "/tmp/bad.json")).toThrow(/\/tmp\/bad\.json/);
  });

  it("http entry writes {type:'http', url} with NO kind field", () => {
    const out = upsertMcpServer({}, "memkin", httpEntry("http://127.0.0.1:3928/mcp")) as any;
    expect(out.mcpServers.memkin).toEqual({ type: "http", url: "http://127.0.0.1:3928/mcp" });
    expect(out.mcpServers.memkin).not.toHaveProperty("kind");
  });

  it("stdio entry writes {command, args} with NO kind field", () => {
    const out = upsertMcpServer({}, "memkin", stdioEntry("memkin", ["serve", "--mcp"])) as any;
    expect(out.mcpServers.memkin).toEqual({ command: "memkin", args: ["serve", "--mcp"] });
    expect(out.mcpServers.memkin).not.toHaveProperty("kind");
  });
});
