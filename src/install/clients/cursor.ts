import { existsSync } from "node:fs";
import { join } from "node:path";
import { DIRECTIVE_L1, MEMKIN_BLOCK_END, MEMKIN_BLOCK_START } from "../directive.js";
import { type ClientAdapter, mcpEntry, type PlanCtx } from "../types.js";

// Cursor rules use `.mdc` with required frontmatter, so memkin owns the whole
// file (managed-file) rather than appending a marker block.
const L1_BODY = DIRECTIVE_L1.replace(MEMKIN_BLOCK_START, "").replace(MEMKIN_BLOCK_END, "").trim();
const CURSOR_MDC = `---\nalwaysApply: true\n---\n\n${L1_BODY}\n`;

export const cursor: ClientAdapter = {
  id: "cursor",
  displayName: "Cursor",
  // TODO(SP4 T6b): verify HTTP support
  supportsHttp: false,
  detect(home) {
    return existsSync(join(home, ".cursor"));
  },
  plan(ctx: PlanCtx) {
    const base = ctx.scope === "project" ? ctx.cwd : ctx.home;
    const mcpPath = join(base, ".cursor", "mcp.json");
    const rulesPath = join(base, ".cursor", "rules", "memkin.mdc");
    return [
      {
        path: mcpPath,
        kind: "json-mcp",
        action: ctx.action,
        entry: ctx.action === "upsert" ? mcpEntry(ctx) : undefined,
      },
      {
        path: rulesPath,
        kind: "managed-file",
        action: ctx.action,
        content: ctx.action === "upsert" ? CURSOR_MDC : undefined,
      },
    ];
  },
};
