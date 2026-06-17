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

export interface StartupPlan {
  runSetup: boolean;
  thenServe: boolean;
}

export function planStartup(configExists: boolean): StartupPlan {
  return { runSetup: !configExists, thenServe: true };
}
