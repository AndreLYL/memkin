import { describe, expect, it, vi } from "vitest";
import { runSessionEnd } from "../../src/hooks/handlers.js";
import { runWriteback } from "../../src/hooks/writeback.js";

describe("runWriteback (opt-in + debounce)", () => {
  it("is a no-op when not opted in", () => {
    const spawnExtract = vi.fn();
    expect(runWriteback({ enabled: false, spawnExtract })).toBe(false);
    expect(spawnExtract).not.toHaveBeenCalled();
  });

  it("fires when enabled and no prior run, recording the stamp", () => {
    const spawnExtract = vi.fn();
    const writeStamp = vi.fn();
    const fired = runWriteback({
      enabled: true,
      now: 1_000_000,
      readStamp: () => null,
      writeStamp,
      spawnExtract,
    });
    expect(fired).toBe(true);
    expect(spawnExtract).toHaveBeenCalledOnce();
    expect(writeStamp).toHaveBeenCalledWith(1_000_000);
  });

  it("skips within the debounce window", () => {
    const spawnExtract = vi.fn();
    const fired = runWriteback({
      enabled: true,
      now: 1_000_000,
      debounceMs: 600_000,
      readStamp: () => 900_000, // 100s ago
      spawnExtract,
    });
    expect(fired).toBe(false);
    expect(spawnExtract).not.toHaveBeenCalled();
  });
});

describe("runSessionEnd", () => {
  it("injects nothing and triggers writeback", async () => {
    const writeback = vi.fn(() => true);
    const out = await runSessionEnd({ reason: "exit" }, { writeback });
    expect(out).toEqual({});
    expect(writeback).toHaveBeenCalledOnce();
  });
});
