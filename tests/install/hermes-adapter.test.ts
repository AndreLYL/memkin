import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { hermes } from "../../src/install/clients/hermes.js";
import { runInstall, runUninstall } from "../../src/install/index.js";
import type { PlanCtx } from "../../src/install/types.js";

let home: string;
let cwd: string;
const base = {
  platform: "linux" as NodeJS.Platform,
  launch: { command: "memkin", args: ["serve", "--mcp"] },
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memkin-home-"));
  cwd = mkdtempSync(join(tmpdir(), "memkin-proj-"));
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
    launch: base.launch,
    action: "upsert",
    transport: "stdio",
    ...over,
  };
}

describe("hermes adapter", () => {
  it("detects ~/.hermes or ~/.openclaw", () => {
    expect(hermes.detect(home, "linux")).toBe(false);
    mkdirSync(join(home, ".openclaw"));
    expect(hermes.detect(home, "linux")).toBe(true);
  });

  it("plans a yaml-mcp op and a skill managed-file op, preferring ~/.hermes", () => {
    mkdirSync(join(home, ".hermes"));
    const ops = hermes.plan(ctx());
    expect(ops[0]).toMatchObject({ path: join(home, ".hermes", "config.yaml"), kind: "yaml-mcp" });
    expect(ops[1]).toMatchObject({
      path: join(home, ".hermes", "skills", "memkin", "SKILL.md"),
      kind: "managed-file",
    });
  });

  it("install writes config.yaml mcp + skill; uninstall removes them", () => {
    mkdirSync(join(home, ".hermes"));
    runInstall({ agent: ["hermes"], home, cwd, ...base });
    const cfg = parse(readFileSync(join(home, ".hermes", "config.yaml"), "utf8"));
    expect(cfg.mcp_servers.memkin).toEqual({ command: "memkin", args: ["serve", "--mcp"] });
    expect(existsSync(join(home, ".hermes", "skills", "memkin", "SKILL.md"))).toBe(true);

    runUninstall({ agent: ["hermes"], home, cwd, ...base });
    const cfg2 = parse(readFileSync(join(home, ".hermes", "config.yaml"), "utf8"));
    expect(cfg2.mcp_servers?.memkin).toBeUndefined();
    expect(existsSync(join(home, ".hermes", "skills", "memkin", "SKILL.md"))).toBe(false);
  });
});
