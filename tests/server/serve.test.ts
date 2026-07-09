import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveHttp, serveStaticSpa } from "../../src/server/serve.js";

// This suite runs under Node (vitest), i.e. the exact runtime `npx memkin` uses when
// Bun isn't installed. It guards against the `ReferenceError: Bun is not defined` crash
// that shipped in 0.4.x: serve/start called Bun.serve/Bun.file, which don't exist under
// Node. If the Node fallback regresses, serveHttp below throws here.
describe("serveHttp (Node fallback)", () => {
  it("binds an OS-assigned port and serves the fetch handler", async () => {
    const handle = await serveHttp({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/ping") return new Response("pong");
        return new Response("nope", { status: 404 });
      },
    });
    try {
      expect(handle.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${handle.port}/ping`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pong");
    } finally {
      handle.stop(true);
    }
  });
});

describe("serveStaticSpa", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "memkin-static-"));
    await writeFile(join(dir, "index.html"), "<title>Memkin</title>");
    await writeFile(join(dir, "app.js"), "console.log(1)");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serves an existing asset with the correct MIME type", async () => {
    const res = await serveStaticSpa(dir, "/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("falls back to index.html for unknown SPA routes", async () => {
    const res = await serveStaticSpa(dir, "/setup");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("<title>Memkin</title>");
  });

  it("does not escape the web-dist root via path traversal", async () => {
    const res = await serveStaticSpa(dir, "/../../../../etc/passwd");
    // Traversal is refused → SPA fallback to index.html, never the real file.
    expect(await res.text()).toContain("<title>Memkin</title>");
  });
});
