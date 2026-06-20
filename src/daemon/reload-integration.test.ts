/**
 * Integration test for the Task-8 serve wiring:
 * ServeRuntimeHolder + ReloadManager + onConfigSaved callback.
 *
 * Uses stub runtimes (no real DB / network) to assert the main-chain behavior
 * "config saved → reload reflected" deterministically.
 */
import { describe, expect, it, vi } from "vitest";
import { ReloadManager } from "./reload-manager.js";
import { ServeRuntimeHolder, type ServeRuntime } from "./serve-runtime.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal LoadedConfig shaped objects for use in ReloadManager. */
const makeConfig = (apiKey: string, schedulerInterval = 3600) =>
  ({
    llm: { provider: "openai", model: "gpt-4o", api_key: apiKey },
    embedding: { provider: "openai", model: "text-embedding-3-small", api_key: "sk-emb" },
    sources: { feishu: { enabled: false } },
    privacy: { mask: false },
    block_builder: { block_gap_minutes: 30 },
    scheduler: {
      enabled: true,
      tick_interval_secs: 60,
      defaults: { interval_secs: schedulerInterval },
      sources: {},
    },
    __context: {
      configPath: "/tmp/memoark.yaml",
      projectRoot: "/tmp",
      missingEnvVars: [],
    },
  }) as never;

function makeRuntime(label: string, reconcileSpy?: () => void): ServeRuntime {
  return {
    scheduler: {
      reconcile: () => { reconcileSpy?.(); },
      drain: async () => {},
      start: async () => {},
    } as never,
    chatNameRefreshJob: undefined,
    getDaemonStatus: () => undefined,
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Serve hot-reload integration (Task 8 wiring)", () => {
  it("Tier 1: scheduling-only save calls scheduler.reconcile, holder unchanged", async () => {
    const reconcileCalls: number[] = [];
    const initial = makeRuntime("initial", () => reconcileCalls.push(1));
    const holder = new ServeRuntimeHolder(initial);

    let buildCount = 0;
    const reloadManager = new ReloadManager({
      holder,
      currentConfig: () => makeConfig("sk-same"),
      buildRuntime: async () => { buildCount++; return makeRuntime("rebuilt"); },
    });

    // Simulate onConfigSaved firing with a scheduler-only change (same signature)
    const onConfigSaved = () => { void reloadManager.run(makeConfig("sk-same", 1800)); };
    onConfigSaved();
    // ReloadManager.run is async but single-flight; wait one tick
    await new Promise((r) => setTimeout(r, 0));

    expect(reconcileCalls).toHaveLength(1);
    expect(buildCount).toBe(0);
    // Holder was NOT swapped — same identity
    expect(holder.current).toBe(initial);
  });

  it("Tier 2: credential change causes rebuild, holder swapped to new runtime", async () => {
    const drained: string[] = [];
    const initial = makeRuntime("initial");
    (initial.scheduler as never as { drain: () => Promise<void> }).drain = async () => {
      drained.push("drained");
    };
    const holder = new ServeRuntimeHolder(initial);

    let builtRuntime: ServeRuntime | null = null;
    const reloadManager = new ReloadManager({
      holder,
      currentConfig: () => makeConfig("sk-old"),
      buildRuntime: async (cfg) => {
        void cfg;
        builtRuntime = makeRuntime("new");
        return builtRuntime;
      },
    });

    // Simulate onConfigSaved firing with a Tier-2 change (different LLM key)
    const onConfigSaved = () => { void reloadManager.run(makeConfig("sk-NEW")); };
    onConfigSaved();
    await new Promise((r) => setTimeout(r, 0));

    expect(drained).toContain("drained");
    expect(builtRuntime).not.toBeNull();
    // Holder was swapped to the new runtime
    expect(holder.current).toBe(builtRuntime);
    // Old runtime was disposed
    expect(initial.dispose).toHaveBeenCalledOnce();
  });

  it("onConfigSaved fires twice rapidly — second queued, both applied in order", async () => {
    const order: string[] = [];
    const holder = new ServeRuntimeHolder(makeRuntime("initial"));

    let callCount = 0;
    const reloadManager = new ReloadManager({
      holder,
      currentConfig: () => makeConfig("sk-base"),
      buildRuntime: async () => {
        const n = ++callCount;
        order.push(`build-start-${n}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`build-end-${n}`);
        return makeRuntime(`built-${n}`);
      },
    });

    const onConfigSaved = (key: string) => { void reloadManager.run(makeConfig(key)); };

    // Fire twice with Tier-2 changes so both trigger rebuilds
    onConfigSaved("sk-A");
    onConfigSaved("sk-B");

    // Wait long enough for both builds to complete
    await new Promise((r) => setTimeout(r, 30));

    // First build completes, then queued second build starts
    expect(order).toEqual(["build-start-1", "build-end-1", "build-start-2", "build-end-2"]);
  });
});
