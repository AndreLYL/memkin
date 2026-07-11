import { existsSync } from "node:fs";
import { join } from "node:path";
import { MEMKIN_SKILL } from "../skill.js";
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
  // Verified: Hermes config.yaml mcp_servers natively supports remote/HTTP
  // servers via a `url` field (https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
  // which matches upsertMcpServerYaml's http branch — safe to wire on pglite.
  supportsHttp: true,
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
        path: join(root, "skills", "memkin", "SKILL.md"),
        kind: "managed-file",
        action: ctx.action,
        content: ctx.action === "upsert" ? MEMKIN_SKILL : undefined,
      },
    ];
  },
};
