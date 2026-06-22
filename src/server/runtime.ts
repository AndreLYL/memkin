import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ServerHandle {
  port: number;
  hostname: string;
  close: () => void;
}

export interface FetchApp {
  fetch: (request: Request) => Response | Promise<Response>;
}

export async function startServer(
  app: FetchApp,
  opts: { port: number; hostname?: string },
): Promise<ServerHandle> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const bun = (
    globalThis as { Bun?: { serve: (options: unknown) => { port: number; stop: () => void } } }
  ).Bun;

  if (bun) {
    const server = bun.serve({ port: opts.port, hostname, fetch: app.fetch });
    return { port: server.port, hostname, close: () => server.stop() };
  }

  const { serve } = await import("@hono/node-server");
  const server = serve({ fetch: app.fetch, port: opts.port, hostname }) as Server;
  let address = server.address();
  let port =
    typeof address === "object" && address !== null ? (address as AddressInfo).port : opts.port;
  if (port === 0) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    address = server.address();
    port =
      typeof address === "object" && address !== null ? (address as AddressInfo).port : opts.port;
  }

  return {
    port,
    hostname,
    close: () => server.close(),
  };
}
