import { describe, expect, it, vi } from "vitest";
import type { DisableAutostartResult } from "../daemon/autostart/index.js";
import type { DownDeps } from "./down.js";
import { down } from "./down.js";

function makeDisableResult(outcome: DisableAutostartResult["outcome"]): DisableAutostartResult {
  return { outcome };
}

function makeDeps(overrides: Partial<DownDeps> = {}): DownDeps {
  const release = vi.fn();
  return {
    home: "/home/user",
    platform: "darwin",
    acquireLock: vi.fn().mockReturnValue({ release }),
    disable: vi.fn().mockResolvedValue(makeDisableResult("success")),
    ...overrides,
  };
}

describe("down", () => {
  it("acquires lock, calls disable, releases lock on success", async () => {
    const deps = makeDeps();
    const result = await down(deps);

    expect(deps.acquireLock).toHaveBeenCalledOnce();
    expect(deps.acquireLock).toHaveBeenCalledWith(deps.home, "down");
    expect(deps.disable).toHaveBeenCalledOnce();
    const lockHandle = (deps.acquireLock as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(lockHandle.release).toHaveBeenCalledOnce();
    expect(result.stopped).toBe(true);
  });

  it("note mentions 'uninstall'", async () => {
    const deps = makeDeps();
    const result = await down(deps);
    expect(result.note).toContain("uninstall");
  });

  it("releases lock even when disable throws", async () => {
    const deps = makeDeps({
      disable: vi.fn().mockRejectedValue(new Error("bootout failed")),
    });

    await expect(down(deps)).rejects.toThrow("bootout failed");

    const lockHandle = (deps.acquireLock as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(lockHandle.release).toHaveBeenCalledOnce();
  });

  // Three-state tests
  describe("three-state teardown", () => {
    it("bootoutFailed → stopped:false, stopManagedPg NOT called", async () => {
      const stopManagedPg = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        disable: vi.fn().mockResolvedValue(makeDisableResult("bootoutFailed")),
        engine: "managed",
        stopManagedPg,
      });
      const result = await down(deps);
      expect(result.stopped).toBe(false);
      expect(result.note).toContain("Daemon may still be running");
      expect(stopManagedPg).not.toHaveBeenCalled();
    });

    it("notLoaded + managed → stopManagedPg called, stopped:true", async () => {
      const stopManagedPg = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        disable: vi.fn().mockResolvedValue(makeDisableResult("notLoaded")),
        engine: "managed",
        stopManagedPg,
      });
      const result = await down(deps);
      expect(result.stopped).toBe(true);
      expect(stopManagedPg).toHaveBeenCalledOnce();
    });

    it("success + managed → stopManagedPg called, stopped:true", async () => {
      const stopManagedPg = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        disable: vi.fn().mockResolvedValue(makeDisableResult("success")),
        engine: "managed",
        stopManagedPg,
      });
      const result = await down(deps);
      expect(result.stopped).toBe(true);
      expect(stopManagedPg).toHaveBeenCalledOnce();
    });

    it("success + pglite (no stopManagedPg) → NOT called, stopped:true", async () => {
      const deps = makeDeps({
        disable: vi.fn().mockResolvedValue(makeDisableResult("success")),
        engine: "pglite",
        // stopManagedPg not provided
      });
      const result = await down(deps);
      expect(result.stopped).toBe(true);
    });

    it("success + no engine → stopped:true (backward compat)", async () => {
      const deps = makeDeps({
        disable: vi.fn().mockResolvedValue(makeDisableResult("success")),
        // engine not provided
      });
      const result = await down(deps);
      expect(result.stopped).toBe(true);
    });
  });
});
