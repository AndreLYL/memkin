import { describe, expect, it } from "vitest";
import type { McpEntry } from "../../src/install/json-config.js";
import { httpEntry } from "../../src/install/mcp-entry.js";
import { removeMcpServerToml, upsertMcpServerToml } from "../../src/install/toml-config.js";

const entry: McpEntry = { kind: "stdio", command: "memoark", args: ["serve", "--mcp"] };

describe("toml-config mcp upsert/remove", () => {
  it("inserts the table into empty content", () => {
    const out = upsertMcpServerToml("", "memoark", entry);
    expect(out).toContain("[mcp_servers.memoark]");
    expect(out).toContain('command = "memoark"');
    expect(out).toContain('args = ["serve", "--mcp"]');
  });

  it("preserves other tables when adding memoark", () => {
    const existing = '[mcp_servers.other]\ncommand = "x"\nargs = []\n';
    const out = upsertMcpServerToml(existing, "memoark", entry);
    expect(out).toContain("[mcp_servers.other]");
    expect(out).toContain('command = "x"');
    expect(out).toContain("[mcp_servers.memoark]");
  });

  it("replaces an existing memoark table in place", () => {
    const existing = '[mcp_servers.memoark]\ncommand = "old"\nargs = []\n\n[other]\nk = 1\n';
    const out = upsertMcpServerToml(existing, "memoark", entry);
    expect(out).not.toContain('command = "old"');
    expect(out).toContain('command = "memoark"');
    expect(out).toContain("[other]");
    expect(out).toContain("k = 1");
    // only one memoark table
    expect(out.split("[mcp_servers.memoark]").length - 1).toBe(1);
  });

  it("http entry renders url = ... and no command", () => {
    const out = upsertMcpServerToml("", "memoark", httpEntry("http://127.0.0.1:3928/mcp"));
    expect(out).toContain("[mcp_servers.memoark]");
    expect(out).toContain('url = "http://127.0.0.1:3928/mcp"');
    expect(out).not.toContain("command =");
  });

  it("removes the memoark table, keeps the rest", () => {
    const existing =
      '[mcp_servers.memoark]\ncommand = "memoark"\nargs = ["serve", "--mcp"]\n\n[other]\nk = 1\n';
    const out = removeMcpServerToml(existing, "memoark");
    expect(out).not.toContain("[mcp_servers.memoark]");
    expect(out).toContain("[other]");
    expect(out).toContain("k = 1");
  });
});
