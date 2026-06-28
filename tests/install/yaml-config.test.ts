import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { McpEntry } from "../../src/install/json-config.js";
import { removeMcpServerYaml, upsertMcpServerYaml } from "../../src/install/yaml-config.js";

const entry: McpEntry = { kind: "stdio", command: "memoark", args: ["serve", "--mcp"] };

describe("yaml-config mcp upsert/remove", () => {
  it("inserts mcp_servers.memoark into empty content", () => {
    const out = upsertMcpServerYaml("", "memoark", entry);
    const parsed = parse(out);
    expect(parsed.mcp_servers.memoark).toEqual({ command: "memoark", args: ["serve", "--mcp"] });
  });

  it("preserves other servers and comments", () => {
    const existing = "# my hermes config\nmcp_servers:\n  other:\n    command: x\n    args: []\n";
    const out = upsertMcpServerYaml(existing, "memoark", entry);
    expect(out).toContain("# my hermes config");
    const parsed = parse(out);
    expect(parsed.mcp_servers.other).toEqual({ command: "x", args: [] });
    expect(parsed.mcp_servers.memoark).toBeDefined();
  });

  it("removes memoark, keeps the rest", () => {
    const existing =
      "mcp_servers:\n  memoark:\n    command: memoark\n    args: []\n  other:\n    command: x\n";
    const out = removeMcpServerYaml(existing, "memoark");
    const parsed = parse(out);
    expect(parsed.mcp_servers.memoark).toBeUndefined();
    expect(parsed.mcp_servers.other).toBeDefined();
  });
});
