import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectInstalledAgents, runInstall, runUninstall } from "../../src/install/index.js";

let home: string;
let cwd: string;
const base = {
  platform: "linux" as NodeJS.Platform,
  launch: { command: "memoark", args: ["serve", "--mcp"] },
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memoark-home-"));
  cwd = mkdtempSync(join(tmpdir(), "memoark-proj-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("install orchestrator", () => {
  it("installs cursor: mcp.json gets memoark, rules .mdc written", () => {
    runInstall({ agent: ["cursor"], home, cwd, ...base });
    const mcp = JSON.parse(read(join(home, ".cursor", "mcp.json")));
    expect(mcp.mcpServers.memoark).toEqual({
      kind: "stdio",
      command: "memoark",
      args: ["serve", "--mcp"],
    });
    const mdc = read(join(home, ".cursor", "rules", "memoark.mdc"));
    expect(mdc).toContain("alwaysApply: true");
    expect(mdc).toContain("Memoark");
  });

  it("is idempotent: second install adds no duplicate memoark entry", () => {
    runInstall({ agent: ["cursor"], home, cwd, ...base });
    runInstall({ agent: ["cursor"], home, cwd, ...base });
    const mcp = JSON.parse(read(join(home, ".cursor", "mcp.json")));
    expect(Object.keys(mcp.mcpServers)).toEqual(["memoark"]);
  });

  it("uninstall removes mcp entry and deletes the managed rules file", () => {
    runInstall({ agent: ["cursor"], home, cwd, ...base });
    runUninstall({ agent: ["cursor"], home, cwd, ...base });
    const mcp = JSON.parse(read(join(home, ".cursor", "mcp.json")));
    expect(mcp.mcpServers.memoark).toBeUndefined();
    expect(existsSync(join(home, ".cursor", "rules", "memoark.mdc"))).toBe(false);
  });

  it("preserves an existing unrelated mcp server on install", () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    require("node:fs").writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }, null, 2),
    );
    runInstall({ agent: ["cursor"], home, cwd, ...base });
    const mcp = JSON.parse(read(join(home, ".cursor", "mcp.json")));
    expect(mcp.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(mcp.mcpServers.memoark).toBeDefined();
  });

  it("no --agent installs only to detected clients", () => {
    // nothing installed → nothing planned
    expect(runInstall({ home, cwd, ...base })).toHaveLength(0);
    // create codex dir → detect-all picks codex
    mkdirSync(join(home, ".codex"));
    const planned = runInstall({ home, cwd, ...base });
    expect(planned.map((p) => p.id)).toEqual(["codex"]);
    expect(existsSync(join(home, ".codex", "config.toml"))).toBe(true);
  });

  it("dry-run returns a plan but writes nothing", () => {
    const planned = runInstall({ agent: ["cursor"], home, cwd, dryRun: true, ...base });
    expect(planned[0].ops.length).toBeGreaterThan(0);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("throws on unknown agent id", () => {
    expect(() => runInstall({ agent: ["nope"], home, cwd, ...base })).toThrow(/Unknown agent/);
  });

  it("detectInstalledAgents reflects on-disk config dirs", () => {
    expect(detectInstalledAgents(home, "linux")).toEqual([]);
    mkdirSync(join(home, ".claude"));
    expect(detectInstalledAgents(home, "linux")).toContain("claude-code");
  });
});
