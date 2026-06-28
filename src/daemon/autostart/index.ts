import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonState } from "./daemon-state.js";
import { readDaemonState, writeDaemonState } from "./daemon-state.js";
import { launchdBootout, launchdLoad, launchdStatus, renderLaunchdPlist } from "./launchd.js";
import type { CommandRunner } from "./runner.js";
import { renderSystemdUnit, systemdDisable, systemdEnable, systemdStatus } from "./systemd.js";

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
  const { platform, home, runner, state, env } = opts;

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
    writeFileSync(plistPath(home), plist, "utf8");

    const sd = stateDir(home);
    mkdirSync(sd, { recursive: true });
    writeDaemonState(sd, state);

    const uid = process.getuid?.() ?? 0;
    await launchdLoad(runner, plistPath(home), uid);
  } else if (platform === "linux") {
    const unit = renderSystemdUnit({
      description: "Memoark Daemon",
      argv: state.argv,
      env,
    });

    const unitDir = join(home, ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(systemdUnitPath(home), unit, "utf8");

    const sd = stateDir(home);
    mkdirSync(sd, { recursive: true });
    writeDaemonState(sd, state);

    await systemdEnable(runner);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function disableAutostart(opts: DisableAutostartOptions): Promise<void> {
  const { platform, home, runner } = opts;

  if (platform === "darwin") {
    const uid = process.getuid?.() ?? 0;
    await launchdBootout(runner, LABEL, uid);
    rmSync(plistPath(home), { force: true });
    rmSync(join(stateDir(home), "daemon.json"), { force: true });
  } else if (platform === "linux") {
    await systemdDisable(runner);
    rmSync(systemdUnitPath(home), { force: true });
    rmSync(join(stateDir(home), "daemon.json"), { force: true });
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
