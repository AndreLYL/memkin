import { existsSync } from "node:fs";
import { join } from "node:path";
import { DIRECTIVE_L1 } from "../directive.js";
import { type ClientAdapter, mcpEntry, type PlanCtx } from "../types.js";

export const claudeCode: ClientAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  supportsHttp: true,
  detect(home) {
    return existsSync(join(home, ".claude")) || existsSync(join(home, ".claude.json"));
  },
  plan(ctx: PlanCtx) {
    const mcpPath =
      ctx.scope === "project" ? join(ctx.cwd, ".mcp.json") : join(ctx.home, ".claude.json");
    const rulesPath =
      ctx.scope === "project" ? join(ctx.cwd, "CLAUDE.md") : join(ctx.home, ".claude", "CLAUDE.md");
    return [
      {
        path: mcpPath,
        kind: "json-mcp",
        action: ctx.action,
        entry: ctx.action === "upsert" ? mcpEntry(ctx) : undefined,
      },
      {
        path: rulesPath,
        kind: "marked-block",
        action: ctx.action,
        content: ctx.action === "upsert" ? DIRECTIVE_L1 : undefined,
      },
    ];
  },
};
