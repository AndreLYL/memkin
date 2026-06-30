import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
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

describe("runUp integration (reconcile failure — FIX 2)", () => {
  let tmpHome: string;
  let configPath: string;
  const OLD_INSTANCE_ID = "prior-instance-id-abc123";

  beforeEach(() => {
    tmpHome = join(tmpdir(), `memoark-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpHome, { recursive: true });
    mkdirSync(join(tmpHome, "Library", "LaunchAgents"), { recursive: true });
    mkdirSync(join(tmpHome, ".memoark"), { recursive: true });

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
        "    port: 3930",
        "    allowed_origins:",
        "      - http://127.0.0.1:3930",
        "    allowed_hosts:",
        "      - 127.0.0.1:3930",
        "    read_only: false",
      ].join("\n"),
    );

    // Pre-seed a prior daemon.json to trigger reconcile mode
    const priorState = {
      instance_id: OLD_INSTANCE_ID,
      config_path: configPath,
      raw_yaml_hash: "oldhash",
      serving_subset_hash: "oldsubset",
      url: "http://127.0.0.1:3930/mcp",
      argv: ["/old/memoark", "serve"],
    };
    writeFileSync(
      join(tmpHome, ".memoark", "daemon.json"),
      JSON.stringify(priorState, null, 2),
      "utf8",
    );
    // Pre-seed a prior plist (the "old service file")
    writeFileSync(
      join(tmpHome, "Library", "LaunchAgents", "com.memoark.daemon.plist"),
      "<?xml version='1.0'?><plist><!-- old plist --></plist>",
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reconcile run where health NEVER becomes ready → rejects AND disableAutostart ran AND daemon.json has OLD instance_id", async () => {
    // Runner: first call is launchctl bootstrap (succeed), subsequent calls are bootout (best-effort)
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // launchctl bootstrap for new service
      { code: 0, stdout: "", stderr: "" }, // launchctl bootout during restoreOld disableAutostart
      { code: 0, stdout: "", stderr: "" }, // launchctl bootstrap for restored old service
    ]);

    // Health always returns 503 / not ready
    const fetchHealthImpl = async (_url: string) => ({ status: 503, body: {} });

    // runUp must reject because health never becomes ready
    await expect(
      runUp(
        { config: configPath },
        {
          runner,
          fetchHealthImpl,
          home: tmpHome,
          platform: "darwin",
          daemonRuntime: fakeDaemonRuntime,
        },
      ),
    ).rejects.toThrow(/rolled back|readiness/i);

    // FIX 2: disableAutostart (bootout) must have been called during restore
    // launchctl calls: bootstrap(new) + bootout(disable) + bootstrap(old)
    const launchctlCalls = runner.calls.filter((c) => c[0] === "launchctl");
    expect(launchctlCalls.length).toBeGreaterThanOrEqual(2);
    // At least one bootout call
    expect(launchctlCalls.some((c) => c.includes("bootout"))).toBe(true);

    // daemon.json must end up with the OLD instance_id (not the new one)
    const finalState = JSON.parse(readFileSync(join(tmpHome, ".memoark", "daemon.json"), "utf8"));
    expect(finalState.instance_id).toBe(OLD_INSTANCE_ID);
  }, 15_000);
});

// ─── P0-3/P0-4: managed foreground provision ordering tests ──────────────────

describe("runUp managed foreground provision ordering (P0-3/P0-4)", () => {
  let tmpHome: string;
  let managedConfigPath: string;
  let pgliteConfigPath: string;

  beforeEach(() => {
    tmpHome = join(tmpdir(), `memoark-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpHome, { recursive: true });
    mkdirSync(join(tmpHome, "Library", "LaunchAgents"), { recursive: true });
    mkdirSync(join(tmpHome, ".memoark"), { recursive: true });

    // Managed engine config
    managedConfigPath = join(tmpHome, "memoark-managed.yaml");
    writeFileSync(
      managedConfigPath,
      [
        "store:",
        "  engine: managed",
        "  managed:",
        "    runtime_dir: /tmp/fake-pg-runtime",
        "mcp:",
        "  http:",
        "    enabled: true",
        "    bind_host: 127.0.0.1",
        "    port: 3931",
        "    allowed_origins:",
        "      - http://127.0.0.1:3931",
        "    allowed_hosts:",
        "      - 127.0.0.1:3931",
        "    read_only: false",
      ].join("\n"),
    );

    // PGlite engine config
    pgliteConfigPath = join(tmpHome, "memoark-pglite.yaml");
    writeFileSync(
      pgliteConfigPath,
      [
        "store:",
        "  engine: pglite",
        "mcp:",
        "  http:",
        "    enabled: true",
        "    bind_host: 127.0.0.1",
        "    port: 3932",
        "    allowed_origins:",
        "      - http://127.0.0.1:3932",
        "    allowed_hosts:",
        "      - 127.0.0.1:3932",
        "    read_only: false",
      ].join("\n"),
    );
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("engine=managed: provisionManagedForeground runs BEFORE enableAutostart (ordering)", async () => {
    const order: string[] = [];

    // Spy: records "provisioned" when called
    const provisionManagedForeground = vi.fn().mockImplementation(async () => {
      order.push("provisioned");
    });

    // Runner: records "enabled" when launchctl bootstrap is called
    const runner = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);

    // fetchHealthImpl: returns ready immediately with correct instance_id
    const fetchHealthImpl = async (_url: string) => {
      try {
        const daemonJson = JSON.parse(
          readFileSync(join(tmpHome, ".memoark", "daemon.json"), "utf8"),
        );
        // Record ordering point here — enableAutostart has already run by the time we poll
        order.push("enabled");
        return {
          status: 200,
          body: {
            instance_id: daemonJson.instance_id,
            db_ok: true,
            read_only: false,
            engine: "managed",
          },
        };
      } catch {
        return { status: 503, body: {} };
      }
    };

    await runUp(
      { config: managedConfigPath },
      {
        runner,
        fetchHealthImpl,
        home: tmpHome,
        platform: "darwin",
        daemonRuntime: fakeDaemonRuntime,
        provisionManagedForeground,
      },
    );

    expect(provisionManagedForeground).toHaveBeenCalledTimes(1);
    // "provisioned" must appear before "enabled" in the order array
    expect(order.indexOf("provisioned")).toBeLessThan(order.indexOf("enabled"));
  }, 15_000);

  it("engine=pglite: provisionManagedForeground is NOT called", async () => {
    const provisionManagedForeground = vi.fn().mockResolvedValue(undefined);

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
            engine: "pglite",
          },
        };
      } catch {
        return { status: 503, body: {} };
      }
    };

    await runUp(
      { config: pgliteConfigPath },
      {
        runner,
        fetchHealthImpl,
        home: tmpHome,
        platform: "darwin",
        daemonRuntime: fakeDaemonRuntime,
        provisionManagedForeground,
      },
    );

    expect(provisionManagedForeground).not.toHaveBeenCalled();
  }, 15_000);
});
