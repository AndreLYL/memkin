import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCode } from "../../src/install/clients/claude-code.js";
import { claudeDesktop } from "../../src/install/clients/claude-desktop.js";
import { codex } from "../../src/install/clients/codex.js";
import { cursor } from "../../src/install/clients/cursor.js";
import { windsurf } from "../../src/install/clients/windsurf.js";
import type { PlanCtx } from "../../src/install/types.js";

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memoark-home-"));
  cwd = mkdtempSync(join(tmpdir(), "memoark-proj-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function ctx(over: Partial<PlanCtx> = {}): PlanCtx {
  return {
    home,
    platform: "linux",
    scope: "global",
    cwd,
    launch: { command: "memoark", args: ["serve", "--mcp"] },
    action: "upsert",
    ...over,
  };
}

describe("client adapters", () => {
  it("claude-code: detect + global plan (json-mcp + CLAUDE.md block)", () => {
    expect(claudeCode.detect(home, "linux")).toBe(false);
    mkdirSync(join(home, ".claude"));
    expect(claudeCode.detect(home, "linux")).toBe(true);

    const ops = claudeCode.plan(ctx());
    expect(ops).toEqual([
      {
        path: join(home, ".claude.json"),
        kind: "json-mcp",
        action: "upsert",
        entry: { kind: "stdio", command: "memoark", args: ["serve", "--mcp"] },
      },
      {
        path: join(home, ".claude", "CLAUDE.md"),
        kind: "marked-block",
        action: "upsert",
        content: expect.stringContaining("Memoark"),
      },
    ]);
  });

  it("claude-code: project scope retargets to .mcp.json + ./CLAUDE.md", () => {
    const ops = claudeCode.plan(ctx({ scope: "project" }));
    expect(ops[0].path).toBe(join(cwd, ".mcp.json"));
    expect(ops[1].path).toBe(join(cwd, "CLAUDE.md"));
  });

  it("claude-desktop: per-OS config path, mcp-only (no rules)", () => {
    mkdirSync(join(home, ".config", "Claude"), { recursive: true });
    expect(claudeDesktop.detect(home, "linux")).toBe(true);
    const linux = claudeDesktop.plan(ctx({ platform: "linux" }));
    expect(linux).toHaveLength(1);
    expect(linux[0].path).toBe(join(home, ".config", "Claude", "claude_desktop_config.json"));

    const mac = claudeDesktop.plan(ctx({ platform: "darwin" }));
    expect(mac[0].path).toBe(
      join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    );
    const win = claudeDesktop.plan(ctx({ platform: "win32" }));
    expect(win[0].path).toBe(
      join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
    );
  });

  it("cursor: detect + managed .mdc rules with frontmatter", () => {
    mkdirSync(join(home, ".cursor"));
    expect(cursor.detect(home, "linux")).toBe(true);
    const ops = cursor.plan(ctx());
    expect(ops[0].path).toBe(join(home, ".cursor", "mcp.json"));
    expect(ops[0].kind).toBe("json-mcp");
    expect(ops[1].path).toBe(join(home, ".cursor", "rules", "memoark.mdc"));
    expect(ops[1].kind).toBe("managed-file");
    expect(ops[1].content).toContain("alwaysApply: true");
  });

  it("codex: toml mcp (global) + AGENTS.md block", () => {
    mkdirSync(join(home, ".codex"));
    expect(codex.detect(home, "linux")).toBe(true);
    const ops = codex.plan(ctx());
    expect(ops[0]).toMatchObject({ path: join(home, ".codex", "config.toml"), kind: "toml-mcp" });
    expect(ops[1]).toMatchObject({
      path: join(home, ".codex", "AGENTS.md"),
      kind: "marked-block",
    });
  });

  it("windsurf: detect + global_rules block", () => {
    mkdirSync(join(home, ".codeium", "windsurf"), { recursive: true });
    expect(windsurf.detect(home, "linux")).toBe(true);
    const ops = windsurf.plan(ctx());
    expect(ops[0].path).toBe(join(home, ".codeium", "windsurf", "mcp_config.json"));
    expect(ops[1].path).toBe(join(home, ".codeium", "windsurf", "memories", "global_rules.md"));
  });

  it("remove action omits entry/content", () => {
    const ops = claudeCode.plan(ctx({ action: "remove" }));
    expect(ops[0].entry).toBeUndefined();
    expect(ops[1].content).toBeUndefined();
  });
});
