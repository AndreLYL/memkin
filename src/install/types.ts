import type { LaunchCmd } from "./command.js";
import type { McpEntry } from "./json-config.js";

export type Scope = "global" | "project";
export type InstallAction = "upsert" | "remove";

export interface PlanCtx {
  home: string;
  platform: NodeJS.Platform;
  scope: Scope;
  cwd: string;
  launch: LaunchCmd;
  action: InstallAction;
}

// A single planned filesystem (or CLI) operation. The orchestrator dispatches by `kind`.
export type InstallOp =
  | { path: string; kind: "json-mcp" | "toml-mcp"; action: InstallAction; entry?: McpEntry }
  | { path: string; kind: "marked-block" | "managed-file"; action: InstallAction; content?: string }
  | { kind: "cli"; action: InstallAction; args: string[] };

export interface ClientAdapter {
  id: string;
  displayName: string;
  /** Is this client installed on the machine? */
  detect(home: string, platform: NodeJS.Platform): boolean;
  /** Planned ops for the requested action; never touches disk. */
  plan(ctx: PlanCtx): InstallOp[];
}

export function mcpEntry(ctx: PlanCtx): McpEntry {
  return { command: ctx.launch.command, args: ctx.launch.args };
}
