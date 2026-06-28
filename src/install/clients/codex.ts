import { existsSync } from "node:fs";
import { join } from "node:path";
import { DIRECTIVE_L1 } from "../directive.js";
import { type ClientAdapter, mcpEntry, type PlanCtx } from "../types.js";

// Codex MCP config is global-only (~/.codex/config.toml); rules go to AGENTS.md
// (global ~/.codex/AGENTS.md or project ./AGENTS.md).
export const codex: ClientAdapter = {
  id: "codex",
  displayName: "Codex",
  supportsHttp: true,
  detect(home) {
    return existsSync(join(home, ".codex"));
  },
  plan(ctx: PlanCtx) {
    const mcpPath = join(ctx.home, ".codex", "config.toml");
    const rulesPath =
      ctx.scope === "project" ? join(ctx.cwd, "AGENTS.md") : join(ctx.home, ".codex", "AGENTS.md");
    return [
      {
        path: mcpPath,
        kind: "toml-mcp",
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
