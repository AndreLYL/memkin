// JSON-based MCP config editing (Claude Code ~/.claude.json, Claude Desktop,
// Cursor ~/.cursor/mcp.json, Windsurf). Operates on parsed objects; the
// orchestrator handles file IO. Other keys/servers are preserved.

export interface McpEntry {
  command: string;
  args: string[];
}

type Json = Record<string, unknown>;

export function parseJsonConfig(text: string, path: string): Json {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a top-level JSON object");
    }
    return parsed as Json;
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
}

function servers(obj: Json): Json {
  const mcp = obj.mcpServers;
  return mcp && typeof mcp === "object" && !Array.isArray(mcp) ? { ...(mcp as Json) } : {};
}

export function upsertMcpServer(obj: Json, name: string, entry: McpEntry): Json {
  const next = servers(obj);
  next[name] = entry;
  return { ...obj, mcpServers: next };
}

export function removeMcpServer(obj: Json, name: string): Json {
  const mcp = obj.mcpServers;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return obj;
  const next = { ...(mcp as Json) };
  delete next[name];
  return { ...obj, mcpServers: next };
}

export function stringifyJsonConfig(obj: Json): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}
