import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type DaemonRuntime =
  | { kind: "compiled"; binaryPath: string }
  | { kind: "node-dist"; execPath: string; distCli: string }
  | { kind: "bun-src"; bunPath: string; srcCli: string }
  | { kind: "bun-dist"; bunPath: string; distCli: string };

export function resolveDaemonArgv(rt: DaemonRuntime, serveTail: string[]): string[] {
  switch (rt.kind) {
    case "compiled":
      return [rt.binaryPath, ...serveTail];
    case "node-dist":
      return [rt.execPath, rt.distCli, ...serveTail];
    case "bun-src":
      return [rt.bunPath, rt.srcCli, ...serveTail];
    case "bun-dist":
      return [rt.bunPath, rt.distCli, ...serveTail];
    default:
      throw new Error("Cannot resolve daemon runtime — build or install Memkin first.");
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

  // 1. compiled: running as a Bun-compiled single binary named "memkin"
  if (hasBun && execPath.endsWith("/memkin")) {
    return { kind: "compiled", binaryPath: execPath };
  }

  // 2. node-dist: running under Node (any non-Bun runtime, incl. node.exe)
  //    with a built dist/cli.js
  const distCli = join(projectRoot, "dist", "cli.js");
  if (!hasBun && checkExists(distCli)) {
    return { kind: "node-dist", execPath, distCli };
  }

  // 3. bun-src: running under Bun with source src/cli.ts (dev repo)
  const srcCli = join(projectRoot, "src", "cli.ts");
  if (hasBun && checkExists(srcCli)) {
    return { kind: "bun-src", bunPath: execPath, srcCli };
  }

  // 4. bun-dist: running under Bun with only dist/cli.js — the global npm
  //    install launched via Bun (the package ships dist/, never src/)
  if (hasBun && checkExists(distCli)) {
    return { kind: "bun-dist", bunPath: execPath, distCli };
  }

  throw new Error("Cannot resolve daemon runtime — build or install Memkin first.");
}
