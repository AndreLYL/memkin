import { exec } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createConfigRoutes } from "./config-routes.js";

const WEB_DIST = join(fileURLToPath(import.meta.url), "../../../web/dist");

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

export interface SetupServerOpts {
  configPath?: string;
  larkBin?: string;
  open?: boolean;
}

export async function startSetupServer(opts: SetupServerOpts = {}): Promise<void> {
  const configPath = opts.configPath ?? resolve(process.cwd(), "memoark.yaml");

  return new Promise((resolvePromise) => {
    const configRoutes = createConfigRoutes({
      configPath,
      larkBin: opts.larkBin,
      onSetupComplete: () => {
        console.log("\n✓ Configuration saved. Run `memoark serve` to start Memoark.");
        // Delay stop so the {ok:true} response actually flushes to the browser
        // before the connection closes; otherwise the front-end sees TypeError:
        // Failed to fetch even though the YAML was written.
        setTimeout(() => {
          server.stop(true);
          resolvePromise();
        }, 500);
      },
    });

    const honoApp = new Hono();
    honoApp.route("/", configRoutes);

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api")) {
          return honoApp.fetch(req);
        }
        const filePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
        const candidate = Bun.file(join(WEB_DIST, filePath));
        if (await candidate.exists()) return new Response(candidate);
        return new Response(Bun.file(join(WEB_DIST, "index.html")));
      },
    });

    const setupUrl = `http://localhost:${server.port}/setup`;
    console.log(`Memoark setup UI running at ${setupUrl}`);
    console.log("Press Ctrl+C to cancel.\n");

    if (opts.open !== false) {
      openBrowser(setupUrl);
    }
  });
}
