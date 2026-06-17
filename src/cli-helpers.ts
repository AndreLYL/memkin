export interface ServeOpenFlags {
  open: boolean;
  mcp: boolean;
  mcpHttp: boolean;
}

export function shouldOpenBrowserOnServe(flags: ServeOpenFlags): boolean {
  if (!flags.open) return false;
  if (flags.mcp || flags.mcpHttp) return false;
  return true;
}
