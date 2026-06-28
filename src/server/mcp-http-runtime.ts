import { isPublicBindHost } from "./mcp-http.js";

export interface McpHttpConfigSubset {
  bind_host: string;
  port: number;
  allowed_origins: string[];
  allowed_hosts: string[];
  read_only: boolean;
  auth_token_env?: string;
}

export interface McpHttpFlags {
  mcpBind?: string;
  mcpPort?: number;
  mcpReadWrite?: boolean;
  mcpAllowedHost?: string[];
  daemonInstanceId?: string;
}

export interface McpHttpRuntime {
  bind: string;
  port: number;
  allowedOrigins: string[];
  allowedHosts: string[];
  readOnly: boolean;
  instanceId?: string;
}

export function resolveMcpHttpRuntime(
  cfg: McpHttpConfigSubset,
  flags: McpHttpFlags,
): McpHttpRuntime {
  const bind = flags.mcpBind ?? cfg.bind_host;
  const port = flags.mcpPort ?? cfg.port;
  const readOnly = flags.mcpReadWrite ? false : cfg.read_only;
  // When the port is overridden, regenerate host/origin allowlists for that port
  // unless explicit --mcp-allowed-host values were provided.
  const allowedHosts =
    flags.mcpAllowedHost && flags.mcpAllowedHost.length > 0
      ? flags.mcpAllowedHost
      : flags.mcpPort !== undefined
        ? [`127.0.0.1:${port}`, `localhost:${port}`]
        : cfg.allowed_hosts;
  const allowedOrigins =
    flags.mcpPort !== undefined && !(flags.mcpAllowedHost && flags.mcpAllowedHost.length)
      ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
      : cfg.allowed_origins;
  return { bind, port, allowedOrigins, allowedHosts, readOnly, instanceId: flags.daemonInstanceId };
}

export function assertLoopbackOrThrow(rt: { bind: string }): void {
  if (isPublicBindHost(rt.bind)) {
    throw new Error(
      `Refusing to start: bind host "${rt.bind}" is not loopback. ` +
        `Memoark's always-on daemon is loopback-only (127.0.0.1). Remote access is not supported in this version.`,
    );
  }
}
