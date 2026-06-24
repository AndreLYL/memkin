import { existsSync } from "node:fs";
import { join } from "node:path";
import { DIRECTIVE_L1 } from "../directive.js";
import { type ClientAdapter, mcpEntry, type PlanCtx } from "../types.js";

export const windsurf: ClientAdapter = {
  id: "windsurf",
  displayName: "Windsurf",
  detect(home) {
    return existsSync(join(home, ".codeium", "windsurf"));
  },
  plan(ctx: PlanCtx) {
    const mcpPath = join(ctx.home, ".codeium", "windsurf", "mcp_config.json");
    const rulesPath =
      ctx.scope === "project"
        ? join(ctx.cwd, ".windsurfrules")
        : join(ctx.home, ".codeium", "windsurf", "memories", "global_rules.md");
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
