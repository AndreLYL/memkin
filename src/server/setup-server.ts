import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createConfigRoutes } from "./config-routes.js";
import { openBrowser } from "./open-browser.js";
import { type ServerHandle, serveHttp, serveStaticSpa } from "./serve.js";

const WEB_DIST = join(fileURLToPath(import.meta.url), "../../../web/dist");

export interface SetupServerOpts {
  configPath?: string;
  larkBin?: string;
  open?: boolean;
}

export async function startSetupServer(opts: SetupServerOpts = {}): Promise<void> {
  const configPath = opts.configPath ?? resolve(process.cwd(), "memkin.yaml");

  let handle: ServerHandle | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const configRoutes = createConfigRoutes({
    configPath,
    larkBin: opts.larkBin,
    onSetupComplete: () => {
      console.log("\n✓ Configuration saved. Run `memkin serve` to start Memkin.");
      // Delay stop so the {ok:true} response actually flushes to the browser
      // before the connection closes; otherwise the front-end sees TypeError:
      // Failed to fetch even though the YAML was written.
      setTimeout(() => {
        handle?.stop(true);
        resolveDone();
      }, 500);
    },
  });

  const honoApp = new Hono();
  honoApp.route("/", configRoutes);

  handle = await serveHttp({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api")) return honoApp.fetch(req);
      return serveStaticSpa(WEB_DIST, url.pathname);
    },
  });

  const setupUrl = `http://localhost:${handle.port}/setup`;
  console.log(`Memkin setup UI running at ${setupUrl}`);
  console.log("Press Ctrl+C to cancel.\n");

  if (opts.open !== false) {
    openBrowser(setupUrl);
  }

  return done;
}
