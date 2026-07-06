import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

// Resolves the command an MCP client should spawn to launch Memkin's stdio
// (or HTTP) server. Prefers a globally-installed `memkin` binary; otherwise
// falls back to `npx -y memkin`.

const PACKAGE = "memkin";

export interface LaunchCmd {
  command: string;
  args: string[];
}

export interface ResolveOpts {
  /** Use the Streamable HTTP transport instead of stdio. */
  http?: boolean;
  /** Injectable PATH lookup for tests. */
  onPath?: (bin: string) => boolean;
}

/** Default check: is `bin` an executable on PATH? */
export function isOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const path = env.PATH ?? "";
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        accessSync(join(dir, bin + ext), constants.X_OK);
        return true;
      } catch {
        // not here; keep looking
      }
    }
  }
  return false;
}

export function resolveLaunchCmd(opts: ResolveOpts = {}): LaunchCmd {
  const transport = opts.http ? "--mcp-http" : "--mcp";
  const onPath = opts.onPath ?? isOnPath;
  if (onPath("memkin")) {
    return { command: "memkin", args: ["serve", transport] };
  }
  return { command: "npx", args: ["-y", PACKAGE, "serve", transport] };
}
