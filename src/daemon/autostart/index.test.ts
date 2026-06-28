import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { disableAutostart, enableAutostart } from "./index.js";
import { makeFakeRunner } from "./runner.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memoark-home-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const state = {
  instance_id: "n",
  config_path: "/c.yaml",
  raw_yaml_hash: "h",
  serving_subset_hash: "s",
  url: "http://127.0.0.1:3928/mcp",
  argv: ["/abs/memoark", "serve", "--mcp-http"],
};

describe("autostart darwin", () => {
  it("enable writes plist + daemon.json + calls launchctl", async () => {
    const runner = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    await enableAutostart({ platform: "darwin", home, runner, state, env: {} });
    const plistPath = join(home, "Library/LaunchAgents/com.memoark.daemon.plist");
    expect(existsSync(plistPath)).toBe(true);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(true);
    expect(runner.calls[0][0]).toBe("launchctl");
    // FIX 1: plist must be mode 0600 (contains secret env values)
    expect(statSync(plistPath).mode & 0o777).toBe(0o600);
  });
  it("enable rejects and cleans up plist + daemon.json when launcher returns non-zero", async () => {
    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "load failed" }]);
    await expect(
      enableAutostart({ platform: "darwin", home, runner, state, env: {} }),
    ).rejects.toThrow(/load failed/);
    expect(existsSync(join(home, "Library/LaunchAgents/com.memoark.daemon.plist"))).toBe(false);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(false);
  });
  it("disable boots out + removes plist + daemon.json (idempotent if absent)", async () => {
    const r1 = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    await enableAutostart({ platform: "darwin", home, runner: r1, state, env: {} });
    const r2 = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    const result = await disableAutostart({ platform: "darwin", home, runner: r2 });
    expect(existsSync(join(home, "Library/LaunchAgents/com.memoark.daemon.plist"))).toBe(false);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(false);
    expect(r2.calls.length).toBeGreaterThan(0);
    expect(result).toEqual({});
  });
  it("disable still removes files when launcher returns non-zero and surfaces the error", async () => {
    const r1 = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    await enableAutostart({ platform: "darwin", home, runner: r1, state, env: {} });
    const r2 = makeFakeRunner([{ code: 1, stdout: "", stderr: "bootout error" }]);
    const result = await disableAutostart({ platform: "darwin", home, runner: r2 });
    expect(existsSync(join(home, "Library/LaunchAgents/com.memoark.daemon.plist"))).toBe(false);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(false);
    expect(result.launcherCode).toBe(1);
    expect(result.launcherStderr).toContain("bootout error");
  });
});

describe("autostart linux", () => {
  it("enable writes unit + daemon.json + calls systemctl", async () => {
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    await enableAutostart({ platform: "linux", home, runner, state, env: {} });
    const unitPath = join(home, ".config/systemd/user/memoark.service");
    expect(existsSync(unitPath)).toBe(true);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(true);
    expect(runner.calls.some((c) => c[0] === "systemctl")).toBe(true);
    // FIX 1: unit file must be mode 0600 (contains secret env values)
    expect(statSync(unitPath).mode & 0o777).toBe(0o600);
  });

  // FIX 4: loginctl enable-linger
  it("enable with linger=true calls loginctl enable-linger on linux", async () => {
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // systemctl daemon-reload
      { code: 0, stdout: "", stderr: "" }, // systemctl enable --now
      { code: 0, stdout: "", stderr: "" }, // loginctl enable-linger
    ]);
    await enableAutostart({ platform: "linux", home, runner, state, env: {}, linger: true });
    expect(runner.calls.some((c) => c[0] === "loginctl" && c.includes("enable-linger"))).toBe(true);
  });

  it("enable without linger does NOT call loginctl", async () => {
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // systemctl daemon-reload
      { code: 0, stdout: "", stderr: "" }, // systemctl enable --now
    ]);
    await enableAutostart({ platform: "linux", home, runner, state, env: {} });
    expect(runner.calls.some((c) => c[0] === "loginctl")).toBe(false);
  });

  it("enable on darwin does NOT call loginctl even when linger is set", async () => {
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // launchctl bootstrap
    ]);
    await enableAutostart({ platform: "darwin", home, runner, state, env: {}, linger: true });
    expect(runner.calls.some((c) => c[0] === "loginctl")).toBe(false);
  });
});
