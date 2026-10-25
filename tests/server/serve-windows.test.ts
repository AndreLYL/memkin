import { beforeEach, describe, expect, it, vi } from "vitest";

const { files, reads } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  reads: vi.fn(),
}));

// Use the real Windows path implementation on every CI host, with only the
// filesystem mocked. This reproduces Windows asset routing under Linux too.
vi.mock("node:path", async (importOriginal) => {
  const path = await importOriginal<typeof import("node:path")>();
  return { ...path.win32, default: path.win32 };
});
vi.mock("node:fs/promises", () => ({
  readFile: async (path: string) => {
    reads(path);
    const content = files.get(path);
    if (content === undefined) throw new Error("ENOENT");
    return Buffer.from(content);
  },
}));

import { serveStaticSpa } from "../../src/server/serve.js";

const root = String.raw`C:\Users\andre\App Data\memkin\web\dist`;
const shell = "<!doctype html><title>Memkin</title>";

beforeEach(() => {
  files.clear();
  reads.mockClear();
  files.set(`${root}\\index.html`, shell);
});

describe("serveStaticSpa with Windows paths", () => {
  it.each([
    ["app.js", "console.log('loaded')", "text/javascript; charset=utf-8"],
    ["app.css", "body{color:black}", "text/css; charset=utf-8"],
    ["font.woff2", "font-bytes", "font/woff2"],
  ])("serves %s as its asset type instead of the SPA HTML", async (name, content, type) => {
    files.set(`${root}\\assets\\${name}`, content);
    const response = await serveStaticSpa(root, `/assets/${name}`);
    expect(response.headers.get("content-type")).toBe(type);
    expect(await response.text()).toBe(content);
  });

  it("keeps the SPA fallback for a person detail URL", async () => {
    const response = await serveStaticSpa(root, "/people/2");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe(shell);
  });

  it("serves files when the configured web root is a drive root", async () => {
    files.set(String.raw`C:\app.js`, "drive-root-asset");
    const response = await serveStaticSpa("C:\\", "/app.js");
    expect(await response.text()).toBe("drive-root-asset");
  });

  it.each([
    [
      "/../dist-extra/secret.js",
      String.raw`C:\Users\andre\App Data\memkin\web\dist-extra\secret.js`,
    ],
    [
      String.raw`/..\private\secret.js`,
      String.raw`C:\Users\andre\App Data\memkin\web\private\secret.js`,
    ],
    [String.raw`/D:\secret.js`, String.raw`D:\secret.js`],
  ])("refuses an escaped target for %s", async (pathname, target) => {
    files.set(target, "private-file");
    const response = await serveStaticSpa(root, pathname);
    expect(await response.text()).toBe(shell);
    expect(reads).not.toHaveBeenCalledWith(target);
  });
});
