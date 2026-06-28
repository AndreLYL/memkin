import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DaemonRuntime =
  | { kind: "compiled"; binaryPath: string }
  | { kind: "node-dist"; execPath: string; distCli: string }
  | { kind: "bun-src"; bunPath: string; srcCli: string };

export function resolveDaemonArgv(rt: DaemonRuntime, serveTail: string[]): string[] {
  switch (rt.kind) {
    case "compiled":
      return [rt.binaryPath, ...serveTail];
    case "node-dist":
      return [rt.execPath, rt.distCli, ...serveTail];
    case "bun-src":
      return [rt.bunPath, rt.srcCli, ...serveTail];
    default:
      throw new Error("Cannot resolve daemon runtime — build or install Memoark first.");
  }
}

export interface DetectDaemonRuntimeDeps {
  execPath: string;
  existsSync: (p: string) => boolean;
  hasBun: boolean;
  projectRoot: string;
}

export function detectDaemonRuntime(deps?: Partial<DetectDaemonRuntimeDeps>): DaemonRuntime {
  const execPath = deps?.execPath ?? process.execPath;
  const checkExists = deps?.existsSync ?? existsSync;
  const hasBun = deps?.hasBun ?? typeof Bun !== "undefined";
  const projectRoot = deps?.projectRoot ?? join(fileURLToPath(import.meta.url), "../../../../");

  // 1. compiled: running as a Bun-compiled single binary named "memoark"
  if (hasBun && execPath.endsWith("/memoark")) {
    return { kind: "compiled", binaryPath: execPath };
  }

  // 2. node-dist: running under Node with a built dist/cli.js
  const distCli = join(projectRoot, "dist", "cli.js");
  if (basename(execPath) === "node" && checkExists(distCli)) {
    return { kind: "node-dist", execPath, distCli };
  }

  // 3. bun-src: running under Bun with source src/cli.ts
  const srcCli = join(projectRoot, "src", "cli.ts");
  if (hasBun && checkExists(srcCli)) {
    return { kind: "bun-src", bunPath: execPath, srcCli };
  }

  throw new Error("Cannot resolve daemon runtime — build or install Memoark first.");
}
