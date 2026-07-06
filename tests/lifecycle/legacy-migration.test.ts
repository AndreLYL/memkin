/**
 * Tests for legacy memoark → memkin auto-migration (R2).
 *
 * The migration runs ONCE at CLI startup, before config load / store open.
 * It covers three moves, all with the same rules:
 *   1. user data dir   ~/.memoark      → ~/.memkin
 *   2. config file      memoark.yaml   → memkin.yaml   (nearest ancestor from
 *      cwd, mirroring resolveConfigPath's upward walk)
 *   3. project state    .memoark/      → .memkin/      (config anchor dir + cwd)
 *
 * Rules: rename-only (never copy-recursive), never merge, never delete when both
 * exist (use new, warn once), silent no-op when neither exists, idempotent, and
 * refuse the data-dir move while a legacy daemon lock is live. All notices go to
 * a caller-supplied sink (stderr in production) so MCP stdio stdout stays clean.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyData } from "../../src/lifecycle/legacy-migration.js";

let home: string;
let cwd: string;

function mkHome(): string {
  return mkdtempSync(join(tmpdir(), "memkin-mig-home-"));
}
function mkCwd(): string {
  return mkdtempSync(join(tmpdir(), "memkin-mig-cwd-"));
}

/** Run migration with an isolated sink; returns collected notices + warnings. */
function run(overrides: Partial<Parameters<typeof migrateLegacyData>[0]> = {}) {
  const notices: string[] = [];
  const warnings: string[] = [];
  migrateLegacyData({
    home,
    cwd,
    env: {},
    notice: (m) => notices.push(m),
    warn: (m) => warnings.push(m),
    ...overrides,
  });
  return { notices, warnings };
}

beforeEach(() => {
  home = mkHome();
  cwd = mkCwd();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("migrateLegacyData — user data dir (~/.memoark → ~/.memkin)", () => {
  it("renames when old exists and new is absent, printing one notice", () => {
    const oldDir = join(home, ".memoark");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "marker.txt"), "hello");

    const { notices } = run();

    expect(existsSync(join(home, ".memkin"))).toBe(true);
    expect(existsSync(oldDir)).toBe(false);
    expect(readFileSync(join(home, ".memkin", "marker.txt"), "utf8")).toBe("hello");
    expect(notices.some((n) => n.includes(".memoark") && n.includes(".memkin"))).toBe(true);
  });

  it("does NOT touch old and warns once when both dirs exist", () => {
    mkdirSync(join(home, ".memoark"), { recursive: true });
    writeFileSync(join(home, ".memoark", "old.txt"), "OLD");
    mkdirSync(join(home, ".memkin"), { recursive: true });
    writeFileSync(join(home, ".memkin", "new.txt"), "NEW");

    const { notices, warnings } = run();

    // both preserved
    expect(readFileSync(join(home, ".memoark", "old.txt"), "utf8")).toBe("OLD");
    expect(readFileSync(join(home, ".memkin", "new.txt"), "utf8")).toBe("NEW");
    // no merge: new dir must not gain old's file
    expect(existsSync(join(home, ".memkin", "old.txt"))).toBe(false);
    // warned, not "migrated"
    expect(warnings.some((w) => w.includes(".memoark"))).toBe(true);
    expect(notices.some((n) => n.toLowerCase().includes("migrated"))).toBe(false);
  });

  it("is a silent no-op when neither dir exists", () => {
    const { notices, warnings } = run();
    expect(notices).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(existsSync(join(home, ".memkin"))).toBe(false);
  });

  it("is idempotent: a second run after a successful migration is silent", () => {
    mkdirSync(join(home, ".memoark"), { recursive: true });
    run(); // first: migrates
    const { notices, warnings } = run(); // second
    expect(notices).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("refuses the data-dir move while a live legacy lifecycle lock is held", () => {
    const oldDir = join(home, ".memoark");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      join(oldDir, "lifecycle.lock"),
      JSON.stringify({ pid: process.pid, command: "serve", hostname: "x", startedAt: "now" }),
    );

    const { notices, warnings } = run();

    // must NOT move it out from under a running instance
    expect(existsSync(oldDir)).toBe(true);
    expect(existsSync(join(home, ".memkin"))).toBe(false);
    expect(notices.some((n) => n.toLowerCase().includes("migrated"))).toBe(false);
    expect(warnings.some((w) => w.toLowerCase().includes("running"))).toBe(true);
  });

  it("proceeds when a legacy lock exists but its pid is dead (stale)", () => {
    const oldDir = join(home, ".memoark");
    mkdirSync(oldDir, { recursive: true });
    // pid 2^31-ish that is essentially never alive
    writeFileSync(
      join(oldDir, "managed-pg.lock"),
      JSON.stringify({ pid: 2147483646, ts: Date.now() }),
    );

    const { notices } = run();
    expect(existsSync(join(home, ".memkin"))).toBe(true);
    expect(existsSync(oldDir)).toBe(false);
    expect(notices.some((n) => n.includes(".memkin"))).toBe(true);
  });
});

describe("migrateLegacyData — config file (memoark.yaml → memkin.yaml)", () => {
  it("renames memoark.yaml → memkin.yaml in cwd when new is absent", () => {
    writeFileSync(join(cwd, "memoark.yaml"), "llm:\n  provider: openai\n");

    const { notices } = run();

    expect(existsSync(join(cwd, "memkin.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "memoark.yaml"))).toBe(false);
    expect(readFileSync(join(cwd, "memkin.yaml"), "utf8")).toContain("provider: openai");
    expect(notices.some((n) => n.includes("memoark.yaml") && n.includes("memkin.yaml"))).toBe(true);
  });

  it("uses new and warns when both config files exist", () => {
    writeFileSync(join(cwd, "memoark.yaml"), "old: true\n");
    writeFileSync(join(cwd, "memkin.yaml"), "new: true\n");

    const { warnings } = run();

    expect(readFileSync(join(cwd, "memkin.yaml"), "utf8")).toContain("new: true");
    expect(readFileSync(join(cwd, "memoark.yaml"), "utf8")).toContain("old: true");
    expect(warnings.some((w) => w.includes("memoark.yaml"))).toBe(true);
  });

  it("only touches the default config filename, never other yaml files", () => {
    // Migration handles the default `memoark.yaml` name only. Files with other
    // names (including anything a user passes via --config, which never enters
    // migration at all) are left alone.
    writeFileSync(join(cwd, "custom.yaml"), "x: 1\n");
    run();
    expect(existsSync(join(cwd, "custom.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "memkin.yaml"))).toBe(false);
  });

  it("renames memoark.yaml found in a PARENT dir when run from a subdir (upward walk)", () => {
    // Mirrors resolveConfigPath: discovery walks up parent dirs, so migration
    // must find the nearest ancestor memoark.yaml and rename it IN PLACE —
    // otherwise post-R1 discovery walks past it and boots on defaults.
    writeFileSync(join(cwd, "memoark.yaml"), "root: true\n");
    const subdir = join(cwd, "packages", "web");
    mkdirSync(subdir, { recursive: true });

    const { notices } = run({ cwd: subdir });

    expect(existsSync(join(cwd, "memkin.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "memoark.yaml"))).toBe(false);
    expect(readFileSync(join(cwd, "memkin.yaml"), "utf8")).toContain("root: true");
    // no stray files created in the subdir itself
    expect(existsSync(join(subdir, "memkin.yaml"))).toBe(false);
    expect(notices.some((n) => n.includes("memoark.yaml") && n.includes("memkin.yaml"))).toBe(true);
  });

  it("applies both-exist rules at the ancestor level (parent has old AND new)", () => {
    writeFileSync(join(cwd, "memoark.yaml"), "old: true\n");
    writeFileSync(join(cwd, "memkin.yaml"), "new: true\n");
    const subdir = join(cwd, "sub");
    mkdirSync(subdir, { recursive: true });

    const { warnings } = run({ cwd: subdir });

    expect(readFileSync(join(cwd, "memkin.yaml"), "utf8")).toContain("new: true");
    expect(readFileSync(join(cwd, "memoark.yaml"), "utf8")).toContain("old: true");
    expect(warnings.some((w) => w.includes("memoark.yaml"))).toBe(true);
  });

  it("a nearer memkin.yaml shadows an older memoark.yaml higher up (walk stops)", () => {
    // Discovery stops at the first memkin.yaml, so a memoark.yaml above it is
    // outside the resolved scope — left untouched, silently.
    writeFileSync(join(cwd, "memoark.yaml"), "outer-old: true\n");
    const subdir = join(cwd, "inner");
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, "memkin.yaml"), "inner-new: true\n");

    const { notices, warnings } = run({ cwd: subdir });

    expect(existsSync(join(cwd, "memoark.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "memkin.yaml"))).toBe(false);
    expect(notices).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});

describe("migrateLegacyData — project-local state dir (./.memoark → ./.memkin)", () => {
  it("renames ./.memoark → ./.memkin in cwd when new is absent", () => {
    mkdirSync(join(cwd, ".memoark"), { recursive: true });
    writeFileSync(join(cwd, ".memoark", "cursors.yaml"), "a: 1");

    const { notices } = run();

    expect(existsSync(join(cwd, ".memkin"))).toBe(true);
    expect(existsSync(join(cwd, ".memoark"))).toBe(false);
    expect(readFileSync(join(cwd, ".memkin", "cursors.yaml"), "utf8")).toBe("a: 1");
    expect(notices.length).toBeGreaterThan(0);
  });

  it("warns and keeps both when project state dirs both exist", () => {
    mkdirSync(join(cwd, ".memoark"), { recursive: true });
    mkdirSync(join(cwd, ".memkin"), { recursive: true });

    const { warnings } = run();
    expect(existsSync(join(cwd, ".memoark"))).toBe(true);
    expect(existsSync(join(cwd, ".memkin"))).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("also migrates .memoark at the config anchor dir when run from a subdir", () => {
    // State files anchor to the config's projectRoot (dirname of the resolved
    // config), not cwd — extract/serve pass projectRoot to ensureStateDir. So a
    // legacy .memoark next to the config in a parent dir must move too.
    writeFileSync(join(cwd, "memoark.yaml"), "root: true\n");
    mkdirSync(join(cwd, ".memoark"), { recursive: true });
    writeFileSync(join(cwd, ".memoark", "cursors.yaml"), "c: 1");
    const subdir = join(cwd, "sub");
    mkdirSync(subdir, { recursive: true });

    run({ cwd: subdir });

    expect(existsSync(join(cwd, ".memkin", "cursors.yaml"))).toBe(true);
    expect(existsSync(join(cwd, ".memoark"))).toBe(false);
  });
});

describe("migrateLegacyData — rename failure (EXDEV / cross-volume)", () => {
  it("leaves the old dir untouched and warns with a manual mv hint on EXDEV", () => {
    const oldDir = join(home, ".memoark");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "marker.txt"), "keep");

    const exdev = Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    const { notices, warnings } = run({
      renameFn: () => {
        throw exdev;
      },
    });

    // never copy-recursively: old stays fully intact, new is never half-created
    expect(existsSync(oldDir)).toBe(true);
    expect(readFileSync(join(oldDir, "marker.txt"), "utf8")).toBe("keep");
    expect(existsSync(join(home, ".memkin"))).toBe(false);
    expect(notices.some((n) => n.toLowerCase().includes("migrated"))).toBe(false);
    // actionable manual-move instruction with real paths
    const w = warnings.join("\n");
    expect(w).toContain("different volumes");
    expect(w).toContain(`mv "${oldDir}" "${join(home, ".memkin")}"`);
  });
});

describe("migrateLegacyData — legacy MEMOARK_* env vars", () => {
  it("warns listing which legacy env vars are set, without honoring them", () => {
    const { warnings } = run({
      env: { MEMOARK_CONFIG: "/tmp/x.yaml", MEMOARK_AUTH_TOKEN: "secret", UNRELATED: "1" },
    });
    const joined = warnings.join("\n");
    expect(joined).toContain("MEMOARK_CONFIG");
    expect(joined).toContain("MEMOARK_AUTH_TOKEN");
    expect(joined).toContain("MEMKIN_");
    // does not leak the value
    expect(joined).not.toContain("secret");
    expect(joined).not.toContain("UNRELATED");
  });

  it("says nothing about env when no MEMOARK_* vars are set", () => {
    const { warnings } = run({ env: { PATH: "/usr/bin", HOME: home } });
    expect(warnings.some((w) => w.includes("MEMOARK_"))).toBe(false);
  });
});
