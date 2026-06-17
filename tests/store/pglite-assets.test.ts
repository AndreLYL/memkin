import { describe, expect, it } from "vitest";
import { resolveAssetDir } from "../../src/store/pglite-assets.js";

describe("resolveAssetDir", () => {
  it("prefers explicit override (Tauri resource dir)", () => {
    expect(
      resolveAssetDir({ override: "/res/assets", execDir: "/app/bin", nodeModulesDir: "/nm" }),
    ).toBe("/res/assets");
  });
  it("falls back to execDir/assets in compiled binary", () => {
    expect(
      resolveAssetDir({ override: undefined, execDir: "/app/bin", nodeModulesDir: "/nm" }),
    ).toBe("/app/bin/assets");
  });
  it("uses node_modules pglite dist in dev (no execDir)", () => {
    expect(
      resolveAssetDir({
        override: undefined,
        execDir: undefined,
        nodeModulesDir: "/nm/pglite/dist",
      }),
    ).toBe("/nm/pglite/dist");
  });
});
