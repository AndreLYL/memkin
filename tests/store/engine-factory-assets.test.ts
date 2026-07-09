import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Guards the desktop sidecar wiring: engine-factory MUST forward the PGLite asset
// override (from --pglite-assets → MEMKIN_PGLITE_ASSETS) into PgliteExecutor.create.
// Dropping it (passing {}) made the compiled Tauri sidecar fall back to the missing
// <execDir>/assets and crash on PGLite init — the desktop first-release blocker.
const createSpy = vi.fn(async () => ({
  query: async () => ({ rows: [] }),
  close: async () => {},
}));

vi.mock("../../src/store/pglite-executor.js", () => ({
  PgliteExecutor: { create: createSpy },
}));

import { createEngine } from "../../src/store/engine-factory.js";

describe("createEngine — PGLite asset override wiring", () => {
  const original = process.env.MEMKIN_PGLITE_ASSETS;

  beforeEach(() => {
    createSpy.mockClear();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MEMKIN_PGLITE_ASSETS;
    else process.env.MEMKIN_PGLITE_ASSETS = original;
  });

  it("forwards MEMKIN_PGLITE_ASSETS as assetsOverride", async () => {
    process.env.MEMKIN_PGLITE_ASSETS = "/opt/memkin.app/Contents/Resources/assets";
    await createEngine({ store: { engine: "pglite", data_dir: "/tmp/d" } } as never);
    expect(createSpy).toHaveBeenCalledWith("/tmp/d", {
      assetsOverride: "/opt/memkin.app/Contents/Resources/assets",
    });
  });

  it("passes assetsOverride: undefined when the env var is unset (dev/npm mode)", async () => {
    delete process.env.MEMKIN_PGLITE_ASSETS;
    await createEngine({ store: { engine: "pglite" } } as never);
    expect(createSpy).toHaveBeenCalledWith(undefined, { assetsOverride: undefined });
  });
});
