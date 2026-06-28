export type McpEntry =
  | { kind: "stdio"; command: string; args: string[] }
  | { kind: "http"; url: string };

export function stdioEntry(command: string, args: string[]): McpEntry {
  return { kind: "stdio", command, args };
}

export function httpEntry(url: string): McpEntry {
  return { kind: "http", url };
}
