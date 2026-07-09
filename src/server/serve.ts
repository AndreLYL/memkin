import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

// Runtime-agnostic HTTP serving. The desktop sidecar runs under Bun (`bun --compile`),
// but the npm package runs under Node via `npx memkin` when Bun isn't installed. Bun's
// `Bun.serve` / `Bun.file` don't exist under Node, so `serve`/`start` crashed there with
// `ReferenceError: Bun is not defined`. This module picks Bun.serve when available and
// falls back to @hono/node-server (already a dependency) otherwise.

type FetchHandler = (req: Request) => Response | Promise<Response>;

export interface ServeOptions {
  port: number;
  hostname: string;
  fetch: FetchHandler;
}

export interface ServerHandle {
  /** The actually-bound port (resolved when `port: 0` asks for an OS-assigned one). */
  port: number;
  /** Stop the server; pass true to also drop active connections. */
  stop: (closeActiveConnections?: boolean) => void;
}

// Safe access — referencing a bare `Bun` under Node throws ReferenceError.
const bunRuntime = (globalThis as { Bun?: { serve: (o: unknown) => unknown } }).Bun;

export async function serveHttp(opts: ServeOptions): Promise<ServerHandle> {
  if (bunRuntime) {
    const server = bunRuntime.serve({
      port: opts.port,
      hostname: opts.hostname,
      fetch: opts.fetch,
    }) as { port: number; stop: (c?: boolean) => void };
    return { port: server.port, stop: (c) => server.stop(c) };
  }

  // Node fallback via @hono/node-server.
  const { serve } = await import("@hono/node-server");
  return new Promise<ServerHandle>((resolvePromise) => {
    const server = serve(
      { fetch: opts.fetch, port: opts.port, hostname: opts.hostname },
      (info: { port: number }) => {
        resolvePromise({
          port: info.port,
          stop: (closeActiveConnections?: boolean) => {
            const s = server as { closeAllConnections?: () => void; close: () => void };
            if (closeActiveConnections) s.closeAllConnections?.();
            s.close();
          },
        });
      },
    );
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve a static asset from `dir` for the given request pathname, falling back to
 * `index.html` (SPA routing). Runtime-agnostic replacement for `Bun.file`.
 */
export async function serveStaticSpa(dir: string, pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = resolve(dir, rel);
  // Guard against path traversal escaping the web-dist root.
  if (target === resolve(dir) || target.startsWith(resolve(dir) + "/")) {
    const buf = await readFile(target).catch(() => null);
    if (buf) {
      const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
      return new Response(buf, { headers: { "content-type": type } });
    }
  }
  const index = await readFile(join(dir, "index.html")).catch(() => null);
  if (index) return new Response(index, { headers: { "content-type": MIME[".html"] } });
  return new Response("Not found", { status: 404 });
}
