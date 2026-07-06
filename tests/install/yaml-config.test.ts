import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { McpEntry } from "../../src/install/json-config.js";
import { httpEntry } from "../../src/install/mcp-entry.js";
import { removeMcpServerYaml, upsertMcpServerYaml } from "../../src/install/yaml-config.js";

const entry: McpEntry = { kind: "stdio", command: "memkin", args: ["serve", "--mcp"] };

describe("yaml-config mcp upsert/remove", () => {
  it("inserts mcp_servers.memkin into empty content", () => {
    const out = upsertMcpServerYaml("", "memkin", entry);
    const parsed = parse(out);
    expect(parsed.mcp_servers.memkin).toEqual({ command: "memkin", args: ["serve", "--mcp"] });
  });

  it("preserves other servers and comments", () => {
    const existing = "# my hermes config\nmcp_servers:\n  other:\n    command: x\n    args: []\n";
    const out = upsertMcpServerYaml(existing, "memkin", entry);
    expect(out).toContain("# my hermes config");
    const parsed = parse(out);
    expect(parsed.mcp_servers.other).toEqual({ command: "x", args: [] });
    expect(parsed.mcp_servers.memkin).toBeDefined();
  });

  it("http entry sets a url node and no command (fixes command:undefined)", () => {
    const out = upsertMcpServerYaml("", "memkin", httpEntry("http://127.0.0.1:3928/mcp"));
    const parsed = parse(out);
    expect(parsed.mcp_servers.memkin).toEqual({ url: "http://127.0.0.1:3928/mcp" });
    expect(out).not.toContain("command");
  });

  it("removes memkin, keeps the rest", () => {
    const existing =
      "mcp_servers:\n  memkin:\n    command: memkin\n    args: []\n  other:\n    command: x\n";
    const out = removeMcpServerYaml(existing, "memkin");
    const parsed = parse(out);
    expect(parsed.mcp_servers.memkin).toBeUndefined();
    expect(parsed.mcp_servers.other).toBeDefined();
  });
});
