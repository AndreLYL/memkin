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
