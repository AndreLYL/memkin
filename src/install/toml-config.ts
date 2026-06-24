// Minimal TOML editing for Codex ~/.codex/config.toml `[mcp_servers.<name>]`
// tables. Intentionally dependency-free and scoped to this one table shape;
// other tables are preserved verbatim.

import type { McpEntry } from "./json-config.js";

function renderTable(header: string, entry: McpEntry): string {
  const args = entry.args.map((a) => JSON.stringify(a)).join(", ");
  return `[${header}]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${args}]`;
}

// Returns [startLine, endLineExclusive] of the `[header]` table, or null.
function findTable(lines: string[], header: string): [number, number] | null {
  const start = lines.findIndex((l) => l.trim() === `[${header}]`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("[")) {
      end = i;
      break;
    }
  }
  return [start, end];
}

function normalize(text: string): string {
  const tidied = text.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "");
  return tidied === "" ? "" : `${tidied}\n`;
}

export function upsertMcpServerToml(text: string, name: string, entry: McpEntry): string {
  const header = `mcp_servers.${name}`;
  const block = renderTable(header, entry);
  const lines = text.split("\n");
  const region = findTable(lines, header);
  if (region) {
    const [start, end] = region;
    let e = end;
    while (e > start + 1 && lines[e - 1].trim() === "") e--;
    const rebuilt = [...lines.slice(0, start), ...block.split("\n"), "", ...lines.slice(e)];
    return normalize(rebuilt.join("\n"));
  }
  const base = text.replace(/\s*$/, "");
  return base === "" ? `${block}\n` : `${base}\n\n${block}\n`;
}

export function removeMcpServerToml(text: string, name: string): string {
  const header = `mcp_servers.${name}`;
  const lines = text.split("\n");
  const region = findTable(lines, header);
  if (!region) return text;
  const [start, end] = region;
  return normalize([...lines.slice(0, start), ...lines.slice(end)].join("\n"));
}
