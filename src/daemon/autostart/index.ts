import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonState } from "./daemon-state.js";
import { readDaemonState, writeDaemonState } from "./daemon-state.js";
import { launchdBootout, launchdLoad, launchdStatus, renderLaunchdPlist } from "./launchd.js";
import type { CommandRunner } from "./runner.js";
import { renderSystemdUnit, systemdDisable, systemdStatus } from "./systemd.js";

const LABEL = "com.memoark.daemon";

function plistPath(home: string): string {
  return join(home, "Library", "LaunchAgents", "com.memoark.daemon.plist");
}

function systemdUnitPath(home: string): string {
  return join(home, ".config", "systemd", "user", "memoark.service");
}

function stateDir(home: string): string {
  return join(home, ".memoark");
}

export interface EnableAutostartOptions {
  platform: string;
  home: string;
  runner: CommandRunner;
  state: DaemonState;
  env: Record<string, string>;
  /** Linux only: run `loginctl enable-linger` so the service survives logout. */
  linger?: boolean;
}

export interface DisableAutostartOptions {
  platform: string;
  home: string;
  runner: CommandRunner;
}

export interface StatusAutostartOptions {
  platform: string;
  home: string;
  runner: CommandRunner;
}

export interface AutostartStatus {
  desired: DaemonState | null;
  raw: string;
}

export async function enableAutostart(opts: EnableAutostartOptions): Promise<void> {
  const { platform, home, runner, state, env, linger } = opts;

  if (platform === "darwin") {
    const logsDir = join(home, ".memoark", "logs");
    const plist = renderLaunchdPlist({
      label: LABEL,
      argv: state.argv,
      stdoutPath: join(logsDir, "daemon.out.log"),
      stderrPath: join(logsDir, "daemon.err.log"),
      env,
    });

    const laDir = join(home, "Library", "LaunchAgents");
    mkdirSync(laDir, { recursive: true });
    writeFileSync(plistPath(home), plist, { encoding: "utf8", mode: 0o600 });
    chmodSync(plistPath(home), 0o600);

    const sd = stateDir(home);
    mkdirSync(sd, { recursive: true });
    writeDaemonState(sd, state);

    const uid = process.getuid?.() ?? 0;
    const result = await launchdLoad(runner, plistPath(home), uid);
    if (result.code !== 0) {
      rmSync(plistPath(home), { force: true });
      rmSync(join(sd, "daemon.json"), { force: true });
      throw new Error(
        `launchctl bootstrap failed (exit ${result.code}): ${result.stderr || result.stdout}`,
      );
    }
  } else if (platform === "linux") {
    const unit = renderSystemdUnit({
      description: "Memoark Daemon",
      argv: state.argv,
      env,
    });

    const unitDir = join(home, ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(systemdUnitPath(home), unit, { encoding: "utf8", mode: 0o600 });
    chmodSync(systemdUnitPath(home), 0o600);

    const sd = stateDir(home);
    mkdirSync(sd, { recursive: true });
    writeDaemonState(sd, state);

    const reloadResult = await runner.run(["systemctl", "--user", "daemon-reload"]);
    if (reloadResult.code !== 0) {
      rmSync(systemdUnitPath(home), { force: true });
      rmSync(join(sd, "daemon.json"), { force: true });
      throw new Error(
        `systemctl daemon-reload failed (exit ${reloadResult.code}): ${reloadResult.stderr || reloadResult.stdout}`,
      );
    }
    const enableResult = await runner.run([
      "systemctl",
      "--user",
      "enable",
      "--now",
      "memoark.service",
    ]);
    if (enableResult.code !== 0) {
      rmSync(systemdUnitPath(home), { force: true });
      rmSync(join(sd, "daemon.json"), { force: true });
      throw new Error(
        `systemctl enable failed (exit ${enableResult.code}): ${enableResult.stderr || enableResult.stdout}`,
      );
    }
    // FIX 4: wire --linger so the service survives user logout
    if (linger) {
      const user = process.env.USER ?? process.env.LOGNAME ?? String(process.getuid?.() ?? "");
      await runner.run(["loginctl", "enable-linger", user]);
      // best-effort: if loginctl fails, we still succeed (linger is advisory)
    }
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

export interface DisableAutostartResult {
  launcherStderr?: string;
  launcherCode?: number;
}

export async function disableAutostart(
  opts: DisableAutostartOptions,
): Promise<DisableAutostartResult> {
  const { platform, home, runner } = opts;

  if (platform === "darwin") {
    const uid = process.getuid?.() ?? 0;
    const result = await launchdBootout(runner, LABEL, uid);
    // Always remove files regardless of launcher exit code (best-effort cleanup)
    rmSync(plistPath(home), { force: true });
    rmSync(join(stateDir(home), "daemon.json"), { force: true });
    if (result.code !== 0) {
      return { launcherCode: result.code, launcherStderr: result.stderr || result.stdout };
    }
    return {};
  } else if (platform === "linux") {
    const result = await systemdDisable(runner);
    // Always remove files regardless of launcher exit code (best-effort cleanup)
    rmSync(systemdUnitPath(home), { force: true });
    rmSync(join(stateDir(home), "daemon.json"), { force: true });
    if (result.code !== 0) {
      return { launcherCode: result.code, launcherStderr: result.stderr || result.stdout };
    }
    return {};
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function statusAutostart(opts: StatusAutostartOptions): Promise<AutostartStatus> {
  const { platform, home, runner } = opts;

  const desired = readDaemonState(stateDir(home));
  const uid = process.getuid?.() ?? 0;

  let result: import("./runner.js").CommandResult;
  if (platform === "darwin") {
    result = await launchdStatus(runner, LABEL, uid);
  } else if (platform === "linux") {
    result = await systemdStatus(runner);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return { desired, raw: result.stdout };
}
