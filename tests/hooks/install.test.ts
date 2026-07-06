import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hooksInstall, hooksUninstall } from "../../src/hooks/install.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memkin-hooks-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
}

describe("hooks install/uninstall", () => {
  it("installs read hooks only by default (no SessionEnd)", () => {
    const res = hooksInstall({ home });
    expect(res.events).toEqual(["SessionStart", "UserPromptSubmit"]);
    const hooks = settings().hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.UserPromptSubmit).toBeDefined();
    expect(hooks.SessionEnd).toBeUndefined();
  });

  it("includes SessionEnd when --write-back is set", () => {
    hooksInstall({ home, writeBack: true });
    expect((settings().hooks as Record<string, unknown>).SessionEnd).toBeDefined();
  });

  it("is idempotent", () => {
    hooksInstall({ home });
    hooksInstall({ home });
    const ss = (settings().hooks as Record<string, unknown>).SessionStart as unknown[];
    expect(ss).toHaveLength(1);
  });

  it("uninstall removes all memkin hooks", () => {
    hooksInstall({ home, writeBack: true });
    hooksUninstall({ home });
    expect(JSON.stringify(settings())).not.toContain("memkin hook");
  });

  it("dry-run writes nothing", () => {
    hooksInstall({ home, dryRun: true });
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
  });
});
