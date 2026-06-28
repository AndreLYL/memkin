import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createMcpServer, type StoreContext } from "./mcp.js";

export interface McpHttpHealth {
  instanceId?: string;
  pid?: number;
  engine?: string;
  version?: string;
  loadedConfigHash?: string;
  /** FIX 5: port/bind echoed in /health so isReady() port/bind checks are load-bearing. */
  port?: number;
  bind?: string;
  dbProbe?: () => Promise<boolean>;
}

export interface McpHttpOptions {
  allowedOrigins: string[];
  allowedHosts: string[];
  authToken?: string;
  exposeLegacyTools?: boolean;
  readOnly?: boolean;
  enableJsonResponse?: boolean;
  health?: McpHttpHealth;
}

export interface McpHttpSecurityError {
  code: "FORBIDDEN_ORIGIN" | "FORBIDDEN_HOST" | "UNAUTHORIZED";
  message: string;
  suggestion: string;
}

export type McpHttpAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: McpHttpSecurityError };

function matchesAllowed(value: string | null, allowed: string[]): boolean {
  if (!value || allowed.length === 0) return true;
  return allowed.includes("*") || allowed.includes(value);
}

function bearerToken(request: Request): string | undefined {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return request.headers.get("x-memoark-mcp-token") ?? undefined;
}

export function isPublicBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized);
}

export function authorizeMcpHttpRequest(
  request: Request,
  options: Pick<McpHttpOptions, "allowedOrigins" | "allowedHosts" | "authToken">,
): McpHttpAuthorization {
  const origin = request.headers.get("origin");
  if (!matchesAllowed(origin, options.allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "FORBIDDEN_ORIGIN",
        message: "Origin is not allowed for Memoark MCP HTTP",
        suggestion: "Use a configured local origin or add the trusted origin explicitly.",
      },
    };
  }

  const host = request.headers.get("host");
  if (!matchesAllowed(host, options.allowedHosts)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "FORBIDDEN_HOST",
        message: "Host is not allowed for Memoark MCP HTTP",
        suggestion: "Use a configured local host or add the trusted host explicitly.",
      },
    };
  }

  if (options.authToken && bearerToken(request) !== options.authToken) {
    return {
      ok: false,
      status: 401,
      error: {
        code: "UNAUTHORIZED",
        message: "MCP HTTP requires a valid bearer token",
        suggestion: "Retry with `Authorization: Bearer <token>` from the configured env var.",
      },
    };
  }

  return { ok: true };
}

export function createMcpHttpApp(stores: StoreContext, options: McpHttpOptions): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    let dbOk = true;
    if (options.health?.dbProbe) {
      try {
        dbOk = await options.health.dbProbe();
      } catch {
        dbOk = false;
      }
    }
    const body = {
      status: dbOk ? "ok" : "degraded",
      transport: "streamable_http",
      auth_required: Boolean(options.authToken),
      read_only: options.readOnly ?? false,
      db_ok: dbOk,
      instance_id: options.health?.instanceId,
      pid: options.health?.pid,
      engine: options.health?.engine,
      version: options.health?.version,
      loaded_config_hash: options.health?.loadedConfigHash,
      // FIX 5: emit port/bind so isReady() port/bind checks are load-bearing
      port: options.health?.port,
      bind: options.health?.bind,
    };
    return c.json(body, dbOk ? 200 : 503);
  });

  app.all("/mcp", async (c) => {
    const authorization = authorizeMcpHttpRequest(c.req.raw, options);
    if (!authorization.ok) {
      return c.json({ error: authorization.error }, authorization.status);
    }

    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      allowedHosts: options.allowedHosts,
      allowedOrigins: options.allowedOrigins,
      enableDnsRebindingProtection: true,
      enableJsonResponse: options.enableJsonResponse ?? true,
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer(stores, {
      exposeLegacyTools: options.exposeLegacyTools,
      readOnly: options.readOnly,
    });
    try {
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    } catch (err) {
      await server.close().catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: {
            code: "MCP_CONNECT_FAILED",
            message: `Failed to connect Memoark MCP HTTP transport: ${message}`,
            suggestion: "Retry the request; if it persists, inspect Memoark server logs.",
          },
        },
        500,
      );
    }
  });

  return app;
}
