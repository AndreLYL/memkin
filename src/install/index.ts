import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { ADAPTERS, getAdapter } from "./clients/index.js";
import { type LaunchCmd, resolveLaunchCmd } from "./command.js";
import {
  parseJsonConfig,
  removeMcpServer,
  stringifyJsonConfig,
  upsertMcpServer,
} from "./json-config.js";
import { removeBlock, upsertBlock } from "./marked-block.js";
import { removeMcpServerToml, upsertMcpServerToml } from "./toml-config.js";
import type { ClientAdapter, InstallAction, InstallOp, PlanCtx, Scope } from "./types.js";
import { removeMcpServerYaml, upsertMcpServerYaml } from "./yaml-config.js";

export interface InstallOptions {
  /** Explicit client ids; empty/undefined → install to all detected. */
  agent?: string[];
  scope?: Scope; // default "global"
  http?: boolean; // register --mcp-http transport
  url?: string; // explicit MCP server URL (for http transport)
  port?: number; // MCP server port when url not provided; default 3928
  dryRun?: boolean;
  // Injectable for tests:
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  launch?: LaunchCmd;
}

export interface PlannedClient {
  id: string;
  displayName: string;
  ops: InstallOp[];
}

function readFileOr(path: string, fallback: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : fallback;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function applyOp(op: InstallOp): void {
  if (op.kind === "cli") {
    spawnSync(op.args[0], op.args.slice(1), { stdio: "ignore" });
    return;
  }
  ensureDir(dirname(op.path));
  switch (op.kind) {
    case "json-mcp": {
      const obj = parseJsonConfig(readFileOr(op.path, ""), op.path);
      const next =
        op.action === "upsert" && op.entry
          ? upsertMcpServer(obj, "memkin", op.entry)
          : removeMcpServer(obj, "memkin");
      writeFileSync(op.path, stringifyJsonConfig(next));
      break;
    }
    case "toml-mcp": {
      const text = readFileOr(op.path, "");
      const next =
        op.action === "upsert" && op.entry
          ? upsertMcpServerToml(text, "memkin", op.entry)
          : removeMcpServerToml(text, "memkin");
      writeFileSync(op.path, next);
      break;
    }
    case "yaml-mcp": {
      const text = readFileOr(op.path, "");
      const next =
        op.action === "upsert" && op.entry
          ? upsertMcpServerYaml(text, "memkin", op.entry)
          : removeMcpServerYaml(text, "memkin");
      writeFileSync(op.path, next);
      break;
    }
    case "marked-block": {
      const text = readFileOr(op.path, "");
      const next =
        op.action === "upsert" && op.content ? upsertBlock(text, op.content) : removeBlock(text);
      writeFileSync(op.path, next);
      break;
    }
    case "managed-file": {
      if (op.action === "upsert" && op.content) {
        ensureDir(dirname(op.path));
        writeFileSync(op.path, op.content);
      } else if (existsSync(op.path)) {
        rmSync(op.path);
      }
      break;
    }
  }
}

function selectAdapters(opts: InstallOptions): ClientAdapter[] {
  if (opts.agent && opts.agent.length > 0) {
    return opts.agent.map((id) => {
      const a = getAdapter(id);
      if (!a) {
        throw new Error(`Unknown agent "${id}". Known: ${ADAPTERS.map((x) => x.id).join(", ")}`);
      }
      return a;
    });
  }
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  return ADAPTERS.filter((a) => a.detect(home, platform));
}

function planFor(
  adapter: ClientAdapter,
  opts: InstallOptions,
  action: InstallAction,
): PlannedClient {
  const port = opts.port ?? 3928;
  const url = opts.url ?? `http://127.0.0.1:${port}/mcp`;
  const transport: "stdio" | "http" = opts.http && adapter.supportsHttp ? "http" : "stdio";
  const ctx: PlanCtx = {
    home: opts.home ?? homedir(),
    platform: opts.platform ?? process.platform,
    scope: opts.scope ?? "global",
    cwd: opts.cwd ?? process.cwd(),
    launch: opts.launch ?? resolveLaunchCmd({ http: opts.http }),
    action,
    transport,
    url,
  };
  return { id: adapter.id, displayName: adapter.displayName, ops: adapter.plan(ctx) };
}

/** Plan without touching disk (for `--dry-run`). */
export function planInstall(opts: InstallOptions, action: InstallAction): PlannedClient[] {
  return selectAdapters(opts).map((a) => planFor(a, opts, action));
}

function execute(opts: InstallOptions, action: InstallAction): PlannedClient[] {
  const planned = planInstall(opts, action);
  if (!opts.dryRun) {
    for (const client of planned) {
      for (const op of client.ops) applyOp(op);
    }
  }
  return planned;
}

export function runInstall(opts: InstallOptions = {}): PlannedClient[] {
  return execute(opts, "upsert");
}

export function runUninstall(opts: InstallOptions = {}): PlannedClient[] {
  return execute(opts, "remove");
}

/** Ids of clients detected as installed on this machine. */
export function detectInstalledAgents(home = homedir(), platform = process.platform): string[] {
  return ADAPTERS.filter((a) => a.detect(home, platform)).map((a) => a.id);
}

export { ADAPTERS } from "./clients/index.js";
