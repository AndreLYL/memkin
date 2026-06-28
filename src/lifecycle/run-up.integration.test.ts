import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DaemonRuntime } from "../daemon/autostart/argv.js";
import { makeFakeRunner } from "../daemon/autostart/runner.js";
import { runUp } from "./run-up.js";

// Fake runtime used across all tests — avoids needing a real binary or dist/cli.js in test env.
const fakeDaemonRuntime: DaemonRuntime = {
  kind: "node-dist",
  execPath: process.execPath,
  distCli: "/fake/dist/cli.js",
};

describe("runUp integration (happy path)", () => {
  let tmpHome: string;
  let configPath: string;

  beforeEach(() => {
    // Create a fresh tmp home + config file
    tmpHome = join(tmpdir(), `memoark-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpHome, { recursive: true });
    // Create Library/LaunchAgents on darwin (test always runs on darwin CI)
    mkdirSync(join(tmpHome, "Library", "LaunchAgents"), { recursive: true });
    mkdirSync(join(tmpHome, ".memoark"), { recursive: true });

    // Minimal config file with postgres engine
    configPath = join(tmpHome, "memoark.yaml");
    writeFileSync(
      configPath,
      [
        "store:",
        "  engine: postgres",
        "  database_url: postgresql://localhost:5432/memoark",
        "mcp:",
        "  http:",
        "    enabled: true",
        "    bind_host: 127.0.0.1",
        "    port: 3929",
        "    allowed_origins:",
        "      - http://127.0.0.1:3929",
        "    allowed_hosts:",
        "      - 127.0.0.1:3929",
        "    read_only: false",
      ].join("\n"),
    );
  });

  it("writes plist/unit file + daemon.json on happy path", async () => {
    // Fake runner: launchctl/systemctl always succeeds
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // launchctl bootstrap
    ]);

    // fetchHealthImpl: returns ready immediately.
    // We read daemon.json to get the instance_id that runUp generated.
    const fetchHealthImpl = async (_url: string) => {
      try {
        const daemonJson = JSON.parse(
          readFileSync(join(tmpHome, ".memoark", "daemon.json"), "utf8"),
        );
        return {
          status: 200,
          body: {
            instance_id: daemonJson.instance_id,
            db_ok: true,
            read_only: false,
            engine: "postgres",
          },
        };
      } catch {
        return { status: 503, body: {} };
      }
    };

    const result = await runUp(
      { config: configPath },
      {
        runner,
        fetchHealthImpl,
        home: tmpHome,
        platform: "darwin",
        daemonRuntime: fakeDaemonRuntime,
      },
    );

    // 1. runUp returns a result
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(result.port).toBe(3929);
    expect(result.engine).toBe("postgres");

    // 2. daemon.json was written
    const daemonJson = JSON.parse(readFileSync(join(tmpHome, ".memoark", "daemon.json"), "utf8"));
    expect(daemonJson.url).toBe(result.url);
    expect(daemonJson.instance_id).toBeTruthy();

    // 3. plist was written (darwin)
    const plistPath = join(tmpHome, "Library", "LaunchAgents", "com.memoark.daemon.plist");
    const plistText = readFileSync(plistPath, "utf8");
    expect(plistText).toContain("com.memoark.daemon");

    // 4. runner was called (launchctl bootstrap)
    expect(runner.calls.length).toBeGreaterThan(0);
  }, 15_000);

  it("detects zero agents (no agents installed in tmp home) → wiredAgents empty", async () => {
    const runner = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    const fetchHealthImpl = async (_url: string) => {
      try {
        const daemonJson = JSON.parse(
          readFileSync(join(tmpHome, ".memoark", "daemon.json"), "utf8"),
        );
        return {
          status: 200,
          body: {
            instance_id: daemonJson.instance_id,
            db_ok: true,
            read_only: false,
            engine: "postgres",
          },
        };
      } catch {
        return { status: 503, body: {} };
      }
    };

    const result = await runUp(
      { config: configPath },
      {
        runner,
        fetchHealthImpl,
        home: tmpHome,
        platform: "darwin",
        daemonRuntime: fakeDaemonRuntime,
      },
    );

    // No agents in tmp home → nothing wired (no error thrown)
    expect(result.wiredAgents).toEqual([]);
    expect(result.engine).toBe("postgres");
  }, 15_000);
});
