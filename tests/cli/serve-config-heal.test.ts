/**
 * serve config self-heal integration test (F1, plan test B).
 *
 * Scenario: an upgraded user's daemon relaunches `memkin serve` with the frozen
 * argv recorded before the memoark → memkin rename, so `--config` points at a
 * file that no longer exists, and ~/.memkin/daemon.json carries the same stale
 * config_path. Pre-fix, serve printed "No configuration file found" and exited 1
 * — the daemon never came back. Post-fix, serve falls back to normal config
 * discovery (resolveConfigPath's upward walk from cwd), boots on the discovered
 * file, and writes the corrected config_path back to daemon.json.
 *
 * The child is killed as soon as the heal is observable on disk — the test does
 * not need (or wait for) the full HTTP/PGLite boot. Runtime selection mirrors
 * legacy-migration-wiring.test.ts: dist build under Node when present, else
 * `src/cli.ts` under Bun. Paths are absolute because cwd is a temp dir.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const DIST_CLI = join(PROJECT_ROOT, "dist", "cli.js");
const BUN = join(process.env.HOME ?? "", ".bun", "bin", "bun");

function cliCommand(): { command: string; args: string[] } {
  if (existsSync(DIST_CLI)) return { command: process.execPath, args: [DIST_CLI] };
  if (existsSync(BUN)) return { command: BUN, args: [join(PROJECT_ROOT, "src", "cli.ts")] };
  return { command: process.execPath, args: [join(PROJECT_ROOT, "bin", "memkin.mjs")] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let child: ChildProcess | undefined;
let fakeHome: string;
let workdir: string;

afterEach(() => {
  child?.kill("SIGKILL");
  child = undefined;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

describe("serve config self-heal (stale daemon.json config_path)", () => {
  it("falls back to discovered config and writes the fix back to daemon.json", async () => {
    // realpathSync: on macOS tmpdir() is /var/... → symlink to /private/var/...;
    // the child's process.cwd() (and thus its discovery walk) sees the realpath.
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "memkin-heal-home-")));
    workdir = realpathSync(mkdtempSync(join(tmpdir(), "memkin-heal-work-")));

    // the real config, discoverable from cwd
    const discoveredConfig = join(workdir, "memkin.yaml");
    writeFileSync(discoveredConfig, "server:\n  http_port: 0\n", "utf8");

    // stale path frozen into the daemon's argv — nothing exists there
    const stalePath = join(fakeHome, "gone", "memoark.yaml");

    // daemon.json carries the same stale config_path
    const stateDir = join(fakeHome, ".memkin");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "daemon.json"),
      JSON.stringify(
        {
          instance_id: "it-1",
          config_path: stalePath,
          raw_yaml_hash: "h",
          serving_subset_hash: "s",
          url: "http://127.0.0.1:3928/mcp",
          argv: ["memkin", "serve"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const cli = cliCommand();
    child = spawn(
      cli.command,
      [
        ...cli.args,
        "serve",
        "-c",
        stalePath,
        "--no-open",
        "--port",
        "0",
        "--daemon-instance-id",
        "it-1",
      ],
      {
        cwd: workdir,
        env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    let exited: { code: number | null } | null = null;
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("exit", (code) => {
      exited = { code };
    });

    // Wait until the heal is visible on disk (it happens before store/HTTP boot).
    const deadline = Date.now() + 30_000;
    let healedPath: string | undefined;
    while (Date.now() < deadline) {
      const state = JSON.parse(readFileSync(join(stateDir, "daemon.json"), "utf8")) as {
        config_path: string;
      };
      if (state.config_path !== stalePath) {
        healedPath = state.config_path;
        break;
      }
      if (exited !== null) break; // pre-fix behavior: exit 1 without healing
      await sleep(100);
    }

    expect(stderr).not.toContain("No configuration file found");
    expect(healedPath).toBe(discoveredConfig);
    // other daemon.json fields survive the rewrite
    const finalState = JSON.parse(readFileSync(join(stateDir, "daemon.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(finalState.instance_id).toBe("it-1");
    expect(finalState.url).toBe("http://127.0.0.1:3928/mcp");
    // and serve told the operator what it did (stderr keeps --mcp stdout clean)
    expect(stderr).toContain(stalePath);
    expect(stderr).toContain(discoveredConfig);
  }, 45_000);
});
