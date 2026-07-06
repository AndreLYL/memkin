/**
 * serve-without-config guidance integration test.
 *
 * Runs the real CLI (via the dist build under Node, or `src/cli.ts` under Bun)
 * with a non-existent config path and asserts it exits non-zero while pointing
 * the user at `memkin start`. We can't use `process.execPath` directly on
 * `src/cli.ts`: under vitest that resolves to Node, which can't load the TS
 * entrypoint, so the runtime is selected the same way the published `bin` does.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const DIST_CLI = join(PROJECT_ROOT, "dist", "cli.js");
const BUN = join(process.env.HOME ?? "", ".bun", "bin", "bun");

function cliCommand(): { command: string; args: string[] } {
  if (existsSync(DIST_CLI)) {
    return { command: process.execPath, args: [DIST_CLI] };
  }
  if (existsSync(BUN)) {
    return { command: BUN, args: ["src/cli.ts"] };
  }
  return { command: process.execPath, args: ["bin/memkin.mjs"] };
}

describe("serve without config", () => {
  it("exits non-zero and points user to `memkin start`", () => {
    const dir = mkdtempSync(join(tmpdir(), "memkin-serve-"));
    const cli = cliCommand();
    const result = spawnSync(cli.command, [...cli.args, "serve", "-c", join(dir, "nope.yaml")], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    });

    expect(result.status).not.toBe(0);
    const out = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    expect(out).toContain("memkin start");
  });
});
