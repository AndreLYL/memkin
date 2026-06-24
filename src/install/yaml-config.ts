import { Document, parseDocument } from "yaml";
import type { McpEntry } from "./json-config.js";

// Minimal YAML editing for Hermes config.yaml `mcp_servers.<name>`. Uses the
// Document API so comments and other keys/servers are preserved.

function load(text: string): Document {
  return text?.trim() ? parseDocument(text) : new Document({});
}

export function upsertMcpServerYaml(text: string, name: string, entry: McpEntry): string {
  const doc = load(text);
  doc.setIn(["mcp_servers", name], { command: entry.command, args: [...entry.args] });
  return doc.toString();
}

export function removeMcpServerYaml(text: string, name: string): string {
  const doc = load(text);
  if (doc.hasIn(["mcp_servers", name])) doc.deleteIn(["mcp_servers", name]);
  return doc.toString();
}
