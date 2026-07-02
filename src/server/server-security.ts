import { timingSafeEqual } from "node:crypto";

/**
 * Loopback / auth policy shared by the `serve` HTTP API server and the MCP HTTP
 * endpoint. Centralizes:
 *  - host resolution (CLI flag > config > loopback default)
 *  - the "non-loopback binds require an auth token" refusal rule
 *  - constant-time bearer-token comparison for the Hono middleware
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * True when `host` is a loopback address (localhost / 127.0.0.1 / ::1).
 * Anything else (0.0.0.0, a LAN IP, a public hostname) is treated as external.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(normalized);
}

export interface ResolveServeHostInput {
  /** `--host` CLI flag (highest precedence). */
  flagHost?: string;
  /** `server.host` from config (fallback). */
  configHost?: string;
}

/**
 * Resolve the effective bind host for `memoark serve`.
 * Precedence: CLI `--host` > config `server.host` > loopback default.
 */
export function resolveServeHost(input: ResolveServeHostInput): string {
  const raw = input.flagHost ?? input.configHost;
  const host = raw?.trim();
  return host && host.length > 0 ? host : "127.0.0.1";
}

export interface ResolveAuthTokenInput {
  /** `MEMOARK_AUTH_TOKEN` env var (highest precedence). */
  envToken?: string;
  /** `server.auth_token` from config (fallback). */
  configToken?: string;
}

/**
 * Resolve the effective auth token for `memoark serve`.
 * Precedence: env `MEMOARK_AUTH_TOKEN` > config `server.auth_token`.
 * Returns undefined when no token is configured (loopback-only, no auth).
 */
export function resolveAuthToken(input: ResolveAuthTokenInput): string | undefined {
  const raw = input.envToken ?? input.configToken;
  const token = raw?.trim();
  return token && token.length > 0 ? token : undefined;
}

export interface ServeSecurity {
  host: string;
  authToken?: string;
}

/**
 * Validate the serve host/token combination and return the effective security
 * settings, or throw with an actionable message.
 *
 * Rule: a non-loopback bind (e.g. 0.0.0.0 or a LAN IP) is only allowed when an
 * auth token is configured. Loopback binds work with or without a token.
 */
export function resolveServeSecurity(
  input: ResolveServeHostInput & ResolveAuthTokenInput,
): ServeSecurity {
  const host = resolveServeHost(input);
  const authToken = resolveAuthToken(input);

  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      `Refusing to start: --host "${host}" binds a non-loopback interface but no auth token is configured. ` +
        `Anyone who can reach this host could read and write your entire memory. ` +
        `Set an auth token first — either 'server.auth_token: <token>' in memoark.yaml ` +
        `or export MEMOARK_AUTH_TOKEN=<token> — then retry.`,
    );
  }

  return { host, authToken };
}

/**
 * Constant-time comparison (length is not secret and short-circuits) of a
 * presented bearer token against the expected token, to avoid leaking the
 * token via timing.
 */
export function tokensMatch(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a bearer token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(req: {
  header?: (name: string) => string | undefined;
}): string | undefined {
  const auth = req.header?.("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return undefined;
}
