import { execFileSync as nodeExecFileSync } from "node:child_process";

export interface RuntimeInfo {
  name: "bun" | "node" | "tsx";
  version: string;
}

type ExecFileSync = typeof nodeExecFileSync;

interface RuntimeDetectionOptions {
  execFileSync?: ExecFileSync;
  platform?: NodeJS.Platform;
}

function normalizeVersion(raw: unknown): string {
  return String(raw).trim().split(/\r?\n/)[0] ?? "";
}

function commandExists(
  command: string,
  execFileSync: ExecFileSync,
  platform: NodeJS.Platform,
): boolean {
  try {
    if (platform === "win32") {
      execFileSync("where.exe", [command], { encoding: "utf-8", stdio: "pipe" });
    } else {
      execFileSync("which", [command], { encoding: "utf-8", stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
}

function commandVersion(command: RuntimeInfo["name"], execFileSync: ExecFileSync): string {
  try {
    const output = execFileSync(command, ["--version"], { encoding: "utf-8", stdio: "pipe" });
    return normalizeVersion(output);
  } catch {
    return "unknown";
  }
}

export function detectCurrentRuntime(): RuntimeInfo {
  const bun = (globalThis as typeof globalThis & { Bun?: { version?: string } }).Bun;
  if (bun) {
    return { name: "bun", version: bun.version ?? "unknown" };
  }
  return { name: "node", version: process.versions.node };
}

export function detectAvailableRuntimes(options: RuntimeDetectionOptions = {}): RuntimeInfo[] {
  const execFileSync = options.execFileSync ?? nodeExecFileSync;
  const platform = options.platform ?? process.platform;
  const runtimes: RuntimeInfo["name"][] = ["bun", "node", "tsx"];

  return runtimes
    .filter((name) => commandExists(name, execFileSync, platform))
    .map((name) => ({ name, version: commandVersion(name, execFileSync) }));
}
