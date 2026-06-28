import { existsSync } from "node:fs";
import { join } from "node:path";
import { MEMOARK_SKILL } from "../skill.js";
import { type ClientAdapter, mcpEntry, type PlanCtx } from "../types.js";

// OpenClaw / Hermes. MCP lives in config.yaml `mcp_servers`; the skill drops
// into the skills dir. Newer Hermes uses ~/.hermes; older OpenClaw layout uses
// ~/.openclaw — detect either and pin the root accordingly.
function hermesRoot(home: string): string {
  return existsSync(join(home, ".hermes")) ? join(home, ".hermes") : join(home, ".openclaw");
}

export const hermes: ClientAdapter = {
  id: "hermes",
  displayName: "OpenClaw / Hermes",
  // TODO(SP4 T6b): verify HTTP support
  supportsHttp: false,
  detect(home) {
    return existsSync(join(home, ".hermes")) || existsSync(join(home, ".openclaw"));
  },
  plan(ctx: PlanCtx) {
    const root = hermesRoot(ctx.home);
    return [
      {
        path: join(root, "config.yaml"),
        kind: "yaml-mcp",
        action: ctx.action,
        entry: ctx.action === "upsert" ? mcpEntry(ctx) : undefined,
      },
      {
        path: join(root, "skills", "memoark", "SKILL.md"),
        kind: "managed-file",
        action: ctx.action,
        content: ctx.action === "upsert" ? MEMOARK_SKILL : undefined,
      },
    ];
  },
};
