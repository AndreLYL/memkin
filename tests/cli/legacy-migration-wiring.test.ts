/**
 * End-to-end wiring test for the legacy memoark → memkin auto-migration.
 *
 * Proves two things that unit tests can't:
 *   1. The commander `preAction` hook actually runs migration for a real command
 *      invocation (here `doctor`, which tolerates a missing config).
 *   2. Migration notices go to STDERR, never STDOUT — the invariant that keeps
 *      `serve --mcp` (JSON-RPC over stdout) and `hook` (JSON over stdout) clean.
 *
 * Runtime selection mirrors serve-smoke.test.ts: dist build under Node when
 * present, else `src/cli.ts` under Bun.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const DIST_CLI = join(PROJECT_ROOT, "dist", "cli.js");
const BUN = join(process.env.HOME ?? "", ".bun", "bin", "bun");

// Absolute entrypoint paths: the test spawns with cwd=workdir (a temp dir) to
// exercise the project-local .memoark migration, so a relative "src/cli.ts"
// would not resolve. Everything is anchored to PROJECT_ROOT.
function cliCommand(): { command: string; args: string[] } {
  if (existsSync(DIST_CLI)) return { command: process.execPath, args: [DIST_CLI] };
  if (existsSync(BUN)) return { command: BUN, args: [join(PROJECT_ROOT, "src", "cli.ts")] };
  return { command: process.execPath, args: [join(PROJECT_ROOT, "bin", "memkin.mjs")] };
}

describe("legacy migration wiring (preAction hook)", () => {
  it("runs migration for a real command and prints the notice to STDERR only", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "memkin-mig-home-"));
    const workdir = mkdtempSync(join(tmpdir(), "memkin-mig-work-"));
    // seed a legacy data dir under the fake HOME
    const legacy = join(fakeHome, ".memoark");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "marker.txt"), "keepme");

    const cli = cliCommand();
    const result = spawnSync(
      cli.command,
      [...cli.args, "doctor", "-c", join(workdir, "none.yaml")],
      {
        cwd: workdir,
        encoding: "utf-8",
        env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
      },
    );

    // migration happened
    expect(existsSync(join(fakeHome, ".memkin", "marker.txt"))).toBe(true);
    expect(existsSync(legacy)).toBe(false);

    // notice on stderr, NOT stdout — the MCP/hook stdout-purity invariant
    expect(result.stderr).toContain("Migrated legacy ~/.memoark → ~/.memkin");
    expect(result.stdout ?? "").not.toContain("Migrated legacy");
  });
});
