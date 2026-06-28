import { describe, expect, it, vi } from "vitest";
import type { DownDeps } from "./down.js";
import { down } from "./down.js";

function makeDeps(overrides: Partial<DownDeps> = {}): DownDeps {
  const release = vi.fn();
  return {
    home: "/home/user",
    platform: "darwin",
    acquireLock: vi.fn().mockReturnValue({ release }),
    disable: vi.fn().mockResolvedValue(undefined),
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
});
