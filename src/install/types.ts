import type { LaunchCmd } from "./command.js";
import type { McpEntry } from "./json-config.js";
import { httpEntry, stdioEntry } from "./mcp-entry.js";

export type Scope = "global" | "project";
export type InstallAction = "upsert" | "remove";

export interface PlanCtx {
  home: string;
  platform: NodeJS.Platform;
  scope: Scope;
  cwd: string;
  launch: LaunchCmd;
  action: InstallAction;
  transport: "stdio" | "http";
  url?: string;
}

// A single planned filesystem (or CLI) operation. The orchestrator dispatches by `kind`.
export type InstallOp =
  | {
      path: string;
      kind: "json-mcp" | "toml-mcp" | "yaml-mcp";
      action: InstallAction;
      entry?: McpEntry;
    }
  | { path: string; kind: "marked-block" | "managed-file"; action: InstallAction; content?: string }
  | { kind: "cli"; action: InstallAction; args: string[] };

export interface ClientAdapter {
  id: string;
  displayName: string;
  supportsHttp: boolean;
  /** Is this client installed on the machine? */
  detect(home: string, platform: NodeJS.Platform): boolean;
  /** Planned ops for the requested action; never touches disk. */
  plan(ctx: PlanCtx): InstallOp[];
}

export function mcpEntry(ctx: PlanCtx): McpEntry {
  if (ctx.transport === "http") {
    if (!ctx.url) throw new Error("http transport requires url");
    return httpEntry(ctx.url);
  }
  return stdioEntry(ctx.launch.command, ctx.launch.args);
}
