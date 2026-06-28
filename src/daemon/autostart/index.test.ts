import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
    expect(existsSync(join(home, "Library/LaunchAgents/com.memoark.daemon.plist"))).toBe(true);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(true);
    expect(runner.calls[0][0]).toBe("launchctl");
  });
  it("disable boots out + removes plist + daemon.json (idempotent if absent)", async () => {
    const r1 = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    await enableAutostart({ platform: "darwin", home, runner: r1, state, env: {} });
    const r2 = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    await disableAutostart({ platform: "darwin", home, runner: r2 });
    expect(existsSync(join(home, "Library/LaunchAgents/com.memoark.daemon.plist"))).toBe(false);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(false);
    expect(r2.calls.length).toBeGreaterThan(0);
  });
});

describe("autostart linux", () => {
  it("enable writes unit + daemon.json + calls systemctl", async () => {
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    await enableAutostart({ platform: "linux", home, runner, state, env: {} });
    expect(existsSync(join(home, ".config/systemd/user/memoark.service"))).toBe(true);
    expect(existsSync(join(home, ".memoark/daemon.json"))).toBe(true);
    expect(runner.calls.some((c) => c[0] === "systemctl")).toBe(true);
  });
});
