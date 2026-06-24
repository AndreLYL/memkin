import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ClientAdapter, mcpEntry, type PlanCtx } from "../types.js";

// Claude Desktop has no rules-file mechanism; it relies on the L2 MCP
// `instructions` field. Install only registers the MCP server.
function configDir(home: string, platform: NodeJS.Platform): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Claude");
  if (platform === "win32") return join(home, "AppData", "Roaming", "Claude");
  return join(home, ".config", "Claude");
}

export const claudeDesktop: ClientAdapter = {
  id: "claude-desktop",
  displayName: "Claude Desktop",
  detect(home, platform) {
    return existsSync(configDir(home, platform));
  },
  plan(ctx: PlanCtx) {
    const path = join(configDir(ctx.home, ctx.platform), "claude_desktop_config.json");
    return [
      {
        path,
        kind: "json-mcp",
        action: ctx.action,
        entry: ctx.action === "upsert" ? mcpEntry(ctx) : undefined,
      },
    ];
  },
};
